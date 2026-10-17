import { useEffect } from "react";
import { useAuth } from "../auth/authContext.ts";
import { startScheduleNotificationCoordinator } from "../lib/scheduleNotificationCoordinator.ts";

/** Lifecycle binding only; delivery policy and coordination live outside React. */
export function ScheduleNotificationRuntime() {
  const { session } = useAuth();
  useEffect(() => startScheduleNotificationCoordinator(session), [session]);
  return null;
}
