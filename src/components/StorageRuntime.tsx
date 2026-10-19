import { useEffect, useState } from "react";
import { ErrorNotice } from "./reliability/Notifications.tsx";
import { useAuth } from "../auth/authContext.ts";
import { reconcileCloudSync } from "../lib/cloudStorage.ts";
import { getSession } from "../auth/auth.ts";

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
      void reconcileCloudSync(accountId).then(() => { if (active) setPreferenceError(""); }).catch((error: unknown) => {
        if (active && getSession()?.account.id === accountId) setPreferenceError(error instanceof Error ? error.message : "Could not check your account’s Cloud Sync preference. Your saved device setting is still available offline.");
      });
    };
    check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check); window.addEventListener("online", check); document.addEventListener("visibilitychange", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check); };
  }, [accountId]);
  return <><ErrorNotice title="Device copy unavailable" message={message} /><ErrorNotice title="Cloud Sync needs attention" message={accountId ? preferenceError : ""} /></>;
}
