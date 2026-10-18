import { useEffect } from "react";
import { useAuth } from "../auth/authContext.ts";
import { startScheduleNotificationCoordinator } from "../lib/scheduleNotificationCoordinator.ts";

/** Lifecycle binding only; delivery policy and coordination live outside React. */
export function ScheduleNotificationRuntime() {
  const { session, requiresAccountChoice } = useAuth();
  useEffect(() => startScheduleNotificationCoordinator(requiresAccountChoice ? null : session), [session, requiresAccountChoice]);
  return null;
}
