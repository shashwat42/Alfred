import { useEffect, useState } from "react";
import { cloudSyncEnabled, STORAGE_MODE_EVENT } from "../lib/localWorkspace.ts";
import { androidNotificationRequest, isAndroid, openScheduleTarget, setNotificationDeliveryStatus, type ScheduleReminder } from "../lib/scheduleNotifications.ts";
import { useAuth } from "../auth/authContext.ts";
import { startScheduleNotificationCoordinator } from "../lib/scheduleNotificationCoordinator.ts";
import { Modal } from "./reliability/States.tsx";

export function ScheduleNotificationRuntime() {
  const { session, requiresAccountChoice } = useAuth();
  const [storageVersion, setStorageVersion] = useState(0);
  const [pendingAlarms, setPendingAlarms] = useState<{ token: string; reminders: ScheduleReminder[] } | null>(null);
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
    if (!session || requiresAccountChoice) return startScheduleNotificationCoordinator(null);
    const stop = startScheduleNotificationCoordinator(session, reminder => {
      setPendingAlarms(current => ({
        token: session.token,
        reminders: [...(current?.token === session.token ? current.reminders : []), reminder],
      }));
    });
    return () => { stop(); setPendingAlarms(null); };
  }, [session, requiresAccountChoice, storageVersion]);
  if (!session || requiresAccountChoice || pendingAlarms?.token !== session.token) return null;
  return <DesktopScheduleAlarm alarms={pendingAlarms.reminders} accountId={session.account.id} dismiss={() => setPendingAlarms(null)} />;
}

function DesktopScheduleAlarm({ alarms, accountId, dismiss }: {
  alarms: ScheduleReminder[];
  accountId: string;
  dismiss: () => void;
}) {
  const latestKey = alarms.at(-1)?.key;
  useEffect(() => {
    const tone = new Audio("/schedule-alarm.wav");
    tone.loop = true;
    void tone.play().catch(() => { /* The reminder remains available in the dialog. */ });
    const timeout = window.setTimeout(() => tone.pause(), 60_000);
    let active = true;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      if (!active) return;
      const window = getCurrentWindow();
      await window.show();
      if (!active) return;
      await window.unminimize();
      if (active) await window.setFocus();
    }).catch(() => { /* The user can also reopen Alfred from the tray. */ });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      tone.pause();
    };
  }, [latestKey]);

  return <Modal title="Schedule alarm" onClose={dismiss}>
    <ul className="schedule-alarm-reminders">
      {alarms.map(alarm => <li key={alarm.key}>
        <strong>{alarm.title}</strong>
        <p>{alarm.body}</p>
        <button type="button" className="settings-action-btn" onClick={() => {
          dismiss();
          openScheduleTarget({ scheduleId: alarm.scheduleId, date: alarm.date, accountId });
        }}>Open schedule</button>
      </li>)}
    </ul>
    <button type="button" className="settings-action-btn" onClick={dismiss}>{alarms.length === 1 ? "Dismiss alarm" : "Dismiss alarms"}</button>
  </Modal>;
}
