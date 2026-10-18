import { useSyncExternalStore } from "react";
import { Download, RefreshCw } from "lucide-react";
import { appUpdates, supportsAppUpdates } from "../../lib/appUpdates.ts";

export function AppUpdateSettings() {
  const state = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot, appUpdates.getSnapshot);
  if (!supportsAppUpdates()) return null;
  const busy = ["checking", "downloading", "installing", "installed"].includes(state.status);
  const percent = state.total ? Math.min(100, Math.round(state.downloaded / state.total * 100)) : null;
  const message = state.status === "checking" ? "Checking for updates…"
    : state.status === "downloading" ? `Downloading update${percent === null ? ` (${(state.downloaded / 1024 / 1024).toFixed(1)} MB)` : `: ${percent}%`}…`
    : state.status === "installing" || state.status === "installed" ? "Installing update. Alfred will close and restart."
    : state.update ? `Alfred ${state.update.version} is available.`
    : state.status === "current" ? "You’re up to date."
    : "Alfred checks automatically for new releases, including betas.";
  return <section className="settings-card-group">
    <h3 className="settings-group-header"><Download size={16} className="settings-group-icon" />App updates</h3>
    <div className="settings-feature-card">
      <div className="settings-feature-row"><div className="settings-feature-info">
        <span className="settings-feature-title" role="status" aria-live="polite">{message}</span>
        <span className="settings-feature-desc">Updates are downloaded only when you choose to install. Save your work first; Alfred will restart.</span>
        {state.lastChecked && <span className="settings-feature-desc">Last checked: {new Date(state.lastChecked).toLocaleString()}</span>}
      </div></div>
      {state.status === "downloading" && <progress aria-label="Update download progress" max={state.total ?? undefined} value={state.total ? state.downloaded : undefined} />}
      {state.update?.notes && <details><summary>What’s new in {state.update.version}</summary><p style={{ whiteSpace: "pre-wrap" }}>{state.update.notes}</p></details>}
      <div className="settings-profile-actions">
        <button type="button" className="settings-action-btn" disabled={busy} onClick={() => void appUpdates.check()}><RefreshCw size={16} />{state.status === "checking" ? "Checking…" : "Check for updates"}</button>
        {state.update && <button type="button" className="settings-action-btn" disabled={busy} onClick={() => void appUpdates.install()}><Download size={16} />{state.status === "downloading" ? "Downloading…" : state.status === "installing" || state.status === "installed" ? "Installing…" : "Download and install"}</button>}
      </div>
      {state.error && <p className="settings-save-feedback" role="alert">{state.error}</p>}
    </div>
  </section>;
}
