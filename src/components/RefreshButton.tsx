import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

export function RefreshButton() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const changed = (event: Event) => setBusy((event as CustomEvent<boolean>).detail);
    window.addEventListener("alfred:refreshing", changed);
    return () => window.removeEventListener("alfred:refreshing", changed);
  }, []);
  if (/Android/i.test(navigator.userAgent)) return null;
  return <button type="button" className="chat-action-btn mobile-account-refresh" aria-label="Refresh account and content" title="Refresh account and content" disabled={busy} onClick={() => window.dispatchEvent(new Event("alfred:refresh"))}><RefreshCw size={17} className={busy ? "animate-spin" : ""} /></button>;
}
