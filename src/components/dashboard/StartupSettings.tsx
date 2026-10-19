import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Power } from "lucide-react";
import { isTauri } from "../../auth/auth.ts";

export function StartupSettings() {
  const supported = isTauri() && /Windows/i.test(navigator.userAgent);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void invoke<boolean>("get_launch_on_startup")
      .then((value) => { if (active) setEnabled(value); })
      .catch((err: unknown) => { if (active) setError(String(err)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [supported]);
  if (!supported) return null;
  return <section className="settings-card-group">
    <h3 className="settings-group-header"><Power size={16} className="settings-group-icon" />Startup</h3>
    <div className="settings-feature-card">
      <div className="settings-feature-row">
        <div className="settings-feature-info">
          <label htmlFor="launch-on-startup" className="settings-feature-title">Launch on startup</label>
          <span className="settings-feature-desc">Open Alfred automatically when you sign in to Windows.</span>
        </div>
        <input id="launch-on-startup" type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={async (event) => {
          const next = event.target.checked;
          setBusy(true); setError("");
          try { setEnabled(await invoke<boolean>("set_launch_on_startup", { enabled: next })); }
          catch (err) { setError(String(err)); }
          finally { setBusy(false); }
        }} />
      </div>
      {error && <p className="settings-save-feedback" role="alert">{error}</p>}
    </div>
  </section>;
}
