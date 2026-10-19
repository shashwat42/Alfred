import { ErrorNotice } from "../components/reliability/Notifications";
import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { androidAssistantRequest, hasAndroidAssistantBridge, type AssistantStatus } from "./assistantBridge.ts";

export function AndroidAssistantSetup() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const available = hasAndroidAssistantBridge();
  useEffect(() => {
    if (!available) return;
    let active = true;
    const refresh = () => {
      void androidAssistantRequest("status").then((result) => {
        if (active) { setStatus(result as unknown as AssistantStatus); setError(""); }
      }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Could not read Android assistant status."); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [available]);
  return <section className="settings-card-group android-assistant-setup">
    <h3 className="settings-group-header"><Smartphone size={16} />Android system assistant</h3>
    <div className="settings-feature-card">
      <div className="settings-feature-info">
        <span className="settings-feature-title">{status?.active ? "Alfred is your active assistant" : "Use Alfred over your current app"}</span>
        <details className="settings-details"><summary>Setup help</summary><p className="settings-feature-desc">Choose Alfred as your default digital assistant in Android settings. Then use your device’s supported assistant gesture or shortcut to open a floating conversation. Gestures depend on your device and launcher.</p>
        <p className="settings-feature-desc">No draw-over-other-apps permission or always-listening microphone is needed. You can keep using Alfred normally if your device does not offer assistant selection.</p></details>
      </div>
      {available ? <button className="settings-action-btn is-login" disabled={busy || status?.supported === false} onClick={async () => {
        setBusy(true); setError("");
        try { await androidAssistantRequest("setup"); }
        catch (err) { setError(err instanceof Error ? err.message : "Could not open Android settings."); }
        finally { setBusy(false); }
      }}>{busy ? "Opening Android setup…" : "Open assistant setup"}</button> : <p className="settings-feature-desc">Install an updated Alfred Android build with Android System WebView to enable setup here. In a browser, assistant registration is unavailable.</p>}
      <p className="settings-feature-desc" role="status">{status ? (!status.supported ? "System assistant requires Android 12 or newer in this build. Text and local voice remain available in the regular Alfred app." : status.active ? "Active — ready for your device’s assistant gesture." : "Not selected. Android will ask you to choose the default assistant.") : ""}</p>
      <ErrorNotice message={error} />
    </div>
  </section>;
}
