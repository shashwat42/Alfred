import { useEffect } from "react";
import { appUpdates, supportsAppUpdates } from "../lib/appUpdates.ts";

export function AppUpdateRuntime() {
  useEffect(() => {
    if (!supportsAppUpdates()) return;
    void appUpdates.check();
    const interval = window.setInterval(() => { void appUpdates.check(); }, 6 * 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);
  return null;
}
