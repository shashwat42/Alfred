import { useEffect, useState } from "react";
import { cloudSyncEnabled, STORAGE_MODE_EVENT } from "../lib/localWorkspace.ts";
import { androidNotificationRequest, isAndroid, setNotificationDeliveryStatus } from "../lib/scheduleNotifications.ts";
import { useAuth } from "../auth/authContext.ts";
import { startScheduleNotificationCoordinator } from "../lib/scheduleNotificationCoordinator.ts";

/** Lifecycle binding only; delivery policy and coordination live outside React. */
export function ScheduleNotificationRuntime() {
  const { session, requiresAccountChoice } = useAuth();
  const [storageVersion, setStorageVersion] = useState(0);
  useEffect(() => {
    const changed = () => setStorageVersion(value => value + 1);
    window.addEventListener(STORAGE_MODE_EVENT, changed); window.addEventListener("storage", changed);
    return () => { window.removeEventListener(STORAGE_MODE_EVENT, changed); window.removeEventListener("storage", changed); };
  }, []);
  useEffect(() => {
    if (!cloudSyncEnabled(session?.account.id)) {
      setNotificationDeliveryStatus("Schedules are stored on this device. Enable Cloud Sync for background reminders.");
      if (isAndroid()) void androidNotificationRequest("clear").catch(() => {});
      return;
    }
    return startScheduleNotificationCoordinator(requiresAccountChoice ? null : session);
  }, [session, requiresAccountChoice, storageVersion]);
  return null;
}
