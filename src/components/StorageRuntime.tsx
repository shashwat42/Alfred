import { useEffect, useState } from "react";
import { ErrorNotice } from "./reliability/Notifications.tsx";
import { useAuth } from "../auth/authContext.ts";
import { reconcileCloudSync } from "../lib/cloudStorage.ts";
import { getSession } from "../auth/auth.ts";
import { syncAccountPreferences, getAccountPreferences, PREFERENCES_CHANGED_EVENT } from "../lib/accountPreferences.ts";
import { STORAGE_MODE_EVENT } from "../lib/localWorkspace.ts";
import { isTauri } from "../auth/auth.ts";

/** A failed device backup must not turn a successful cloud save into a retry. */
export function StorageRuntime() {
  const accountId = useAuth().session?.account.id;
  const [message, setMessage] = useState("");
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => {
    const changed = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener("alfred:storage-warning", changed);
    return () => window.removeEventListener("alfred:storage-warning", changed);
  }, []);
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const check = () => {
      if (document.hidden || !navigator.onLine) return;
      void reconcileCloudSync(accountId).then(() => syncAccountPreferences(accountId)).then(() => { if (active) setPreferenceError(""); }).catch((error: unknown) => {
        if (active && getSession()?.account.id === accountId) setPreferenceError(error instanceof Error ? error.message : "Could not check your account’s Cloud Sync preference. Your saved device setting is still available offline.");
      });
    };
    check();
    const applyStartup = () => {
      if (!active || getSession()?.account.id !== accountId || !isTauri() || !/Windows/i.test(navigator.userAgent)) return;
      void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_launch_on_startup", { enabled: getAccountPreferences().launchOnStartup })).catch(() => { if (active) setPreferenceError("Your startup preference could not be applied on this PC. Retry in Settings."); });
    };
    applyStartup();
    window.addEventListener(PREFERENCES_CHANGED_EVENT, applyStartup);
    window.addEventListener(STORAGE_MODE_EVENT, check);
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check); window.addEventListener("online", check); document.addEventListener("visibilitychange", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener(PREFERENCES_CHANGED_EVENT, applyStartup); window.removeEventListener(STORAGE_MODE_EVENT, check); window.removeEventListener("focus", check); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check); };
  }, [accountId]);
  return <><ErrorNotice title="Device copy unavailable" message={message} /><ErrorNotice title="Cloud Sync needs attention" message={accountId ? preferenceError : ""} /></>;
}
