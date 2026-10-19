import { useEffect } from "react";
import { useAuth } from "../auth/authContext.ts";
import { apiFetch } from "../lib/api.ts";

/** Foreground-only presence, no new accounts and no offline retry queue. */
export function PresenceRuntime() {
  const { session } = useAuth();
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let pending: AbortController | undefined;
    const pause = () => { clearTimeout(timer); pending?.abort(); };
    const beat = async () => {
      if (stopped || document.hidden || !navigator.onLine) return;
      const controller = new AbortController(); pending = controller;
      try { await apiFetch("/api/presence", { method: "POST", signal: controller.signal, _expectedAccountId: session.account.id }); }
      catch { /* Presence is best effort and never interrupts local work. */ }
      finally { if (pending === controller && !controller.signal.aborted && !stopped && !document.hidden && navigator.onLine) timer = setTimeout(beat, 60_000); }
    };
    const resume = () => { pause(); if (!document.hidden && navigator.onLine) void beat(); };
    void beat();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", pause);
    return () => {
      stopped = true; pause(); document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume); window.removeEventListener("offline", pause);
    };
  }, [session]);
  return null;
}
