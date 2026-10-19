import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../auth/auth.ts";
import { StateCard } from "./States.tsx";

/** Cover the app without unmounting drafts or active sessions. */
export function ConnectionStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [serverDown, setServerDown] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if ((!offline && !serverDown) || dismissed) return;
    const element = dialog.current; element?.showModal();
    return () => element?.close();
  }, [offline, serverDown, dismissed]);
  useEffect(() => {
    const online = () => { setOffline(false); setDismissed(false); };
    const lost = () => { setOffline(true); setDismissed(false); };
    const server = (event: Event) => setServerDown((event as CustomEvent<boolean>).detail);
    window.addEventListener("online", online); window.addEventListener("offline", lost); window.addEventListener("alfred:server-unavailable", server);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", lost); window.removeEventListener("alfred:server-unavailable", server); };
  }, []);
  useEffect(() => {
    if (!serverDown || offline) return;
    const controller = new AbortController();
    const check = () => { void fetch(`${API_BASE_URL}/health`, { headers: { "ngrok-skip-browser-warning": "true" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) }).then(response => { if (response.ok && !controller.signal.aborted) setServerDown(false); }).catch(() => {}); };
    check(); const timer = setInterval(check, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [serverDown, offline]);
  if ((!offline && !serverDown) || dismissed) return null;
  const retry = async () => {
    setChecking(true);
    try {
      const response = await fetch(`${API_BASE_URL}/health`, { headers: { "ngrok-skip-browser-warning": "true" }, signal: AbortSignal.timeout(5000) });
      if (response.ok) { setOffline(false); setServerDown(false); window.dispatchEvent(new Event("alfred:refresh-account")); }
    } catch { /* Keep recovery controls visible. */ }
    finally { setChecking(false); }
  };
  return <dialog ref={dialog} className="connection-screen" onCancel={() => setDismissed(true)} aria-label={offline ? "You are offline" : "Server unavailable"}>
    <StateCard title={offline ? "You’re offline" : "Alfred is temporarily unavailable"}>{offline ? "Reconnect to use the assistant and cloud features. Your saved device content is still available." : "We couldn’t reach the Alfred server. Your current work is preserved. We’ll reconnect automatically."}</StateCard>
    <button type="button" disabled={checking} onClick={() => void retry()}>{checking ? "Checking…" : "Try again"}</button>
    <button type="button" onClick={() => setDismissed(true)}>Continue with saved content</button>
  </dialog>;
}
