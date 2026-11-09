import { desktopPlatform } from "../../lib/desktopPlatform.ts";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Power } from "lucide-react";
import { getAccountPreferences, saveAccountPreferences, PREFERENCES_CHANGED_EVENT } from "../../lib/accountPreferences.ts";
import { isTauri } from "../../auth/auth.ts";

export function StartupSettings() {
  const platform = desktopPlatform(navigator.userAgent);
  const supported = isTauri() && platform !== null;
  const [enabled, setEnabled] = useState(() => getAccountPreferences().launchOnStartup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quitting, setQuitting] = useState(false);
  const [quitError, setQuitError] = useState("");
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
    <h3 className="settings-group-header"><Power size={16} className="settings-group-icon" />{platform === "linux" ? "Startup and background" : "Startup"}</h3>
    <div className="settings-feature-card">
      <div className="settings-feature-row">
        <div className="settings-feature-info">
          <label htmlFor="launch-on-startup" className="settings-feature-title">Launch on startup</label>
          <span className="settings-feature-desc">Start Alfred in the background when you sign in. Open it from the system tray or your app launcher.</span>
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
      {platform === "linux" && <div className="settings-feature-row">
        <div className="settings-feature-info">
          <span className="settings-feature-title">Run in background</span>
          <span className="settings-feature-desc">Closing the window keeps Alfred running for reminders and Quick Overlay. Open Alfred from your app launcher to bring the window back.</span>
          {quitError && <p className="settings-save-feedback" role="alert">{quitError}</p>}
        </div>
        <button type="button" className="settings-action-btn" disabled={quitting} onClick={async () => {
          setQuitting(true);
          setQuitError("");
          try { await invoke("quit_alfred"); }
          catch { setQuitError("Could not quit Alfred. Try again."); setQuitting(false); }
        }}>Quit Alfred</button>
      </div>}
    </div>
  </section>;
}
