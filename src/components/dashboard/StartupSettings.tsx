import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Power } from "lucide-react";
import { getAccountPreferences, saveAccountPreferences, PREFERENCES_CHANGED_EVENT } from "../../lib/accountPreferences.ts";
import { isTauri } from "../../auth/auth.ts";

export function StartupSettings() {
  const supported = isTauri() && /Windows/i.test(navigator.userAgent);
  const [enabled, setEnabled] = useState(() => getAccountPreferences().launchOnStartup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supported) return;
    let active = true;
    const changed = () => { if (active) setEnabled(getAccountPreferences().launchOnStartup); };
    changed();
    window.addEventListener(PREFERENCES_CHANGED_EVENT, changed);
    return () => { active = false; window.removeEventListener(PREFERENCES_CHANGED_EVENT, changed); };
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
          try { await invoke<boolean>("set_launch_on_startup", { enabled: next }); saveAccountPreferences({ launchOnStartup: next }); setEnabled(next); }
          catch (err) { setError(String(err)); }
          finally { setBusy(false); }
        }} />
      </div>
      {error && <p className="settings-save-feedback" role="alert">{error}</p>}
    </div>
  </section>;
}
