import { useState, useSyncExternalStore } from "react";
import { Cloud } from "lucide-react";
import { useAuth } from "../../auth/authContext.ts";
import { cloudSyncEnabled, STORAGE_MODE_EVENT } from "../../lib/localWorkspace.ts";
import { changeCloudSync } from "../../lib/cloudStorage.ts";

export function CloudStorageSettings({ refresh }: { refresh: () => void }) {
  const { session } = useAuth();
  const accountId = session?.account.id;
  const enabled = useSyncExternalStore(listener => {
    window.addEventListener(STORAGE_MODE_EVENT, listener); window.addEventListener("storage", listener);
    return () => { window.removeEventListener(STORAGE_MODE_EVENT, listener); window.removeEventListener("storage", listener); };
  }, () => cloudSyncEnabled(accountId));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!accountId) return null;
  return <section className="settings-card-group cloud-storage-settings">
    <h3 className="settings-group-header"><Cloud size={16} className="settings-group-icon" />Cloud storage</h3>
    <div className="settings-feature-card">
      <div className="settings-feature-row"><div className="settings-feature-info">
        <label className="settings-feature-title" htmlFor="cloud-sync-enabled">Cloud Sync</label>
        <p className="settings-feature-desc">Cloud Sync is an account-wide preference shared by all devices signed into this account. It is off by default. Enable it to store tasks, notes and schedules in your account’s cloud storage. Cloud storage limits apply only to uploaded content.</p>
      </div><input id="cloud-sync-enabled" type="checkbox" checked={enabled} disabled={busy} onChange={event => {
        const next = event.target.checked;
        setBusy(true); setError("");
        void changeCloudSync(accountId, next).then(refresh).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not change Cloud Sync.")).finally(() => setBusy(false));
      }} /></div>
      <p className="settings-feature-desc" role="status">{busy ? "Saving a device copy and updating Cloud Sync…" : enabled ? "Cloud Sync is enabled for your account on all devices. Internet access is required for cloud changes." : "Local storage is active. Clearing app data or uninstalling can remove this device’s content. Account identity and AI usage records are still kept online."}</p>
      <p className="settings-feature-desc">Turning Cloud Sync off applies to the whole account. It downloads your cloud content to this device, then removes the account’s cloud workspace and cloud reminder registrations. Other devices switch to their saved device copies when they reconnect; only this device is guaranteed to receive the final download.</p>
      {enabled && <button type="button" className="settings-action-btn" disabled={busy} onClick={() => {
        setBusy(true); setError(""); void changeCloudSync(accountId, true).then(refresh).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not sync device content.")).finally(() => setBusy(false));
      }}>Sync this device’s saved content</button>}
      {!enabled && <button type="button" className="settings-action-btn" disabled={busy} onClick={() => {
        setBusy(true); setError(""); void changeCloudSync(accountId, false).then(refresh).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not move cloud data.")).finally(() => setBusy(false));
      }}>Move existing cloud data to this device</button>}
      {error && <p className="settings-save-feedback" role="alert">{error}</p>}
    </div>
  </section>;
}
