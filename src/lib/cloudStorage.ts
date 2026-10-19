import { apiJson } from "./api.ts";
import { getSession } from "../auth/auth.ts";
import { activateLocalStorage, cloudSyncEnabled, readLocalWorkspace, setCloudSyncEnabled, updateLocalWorkspace } from "./localWorkspace.ts";
import { emptyWorkspace, mergeWorkspace, type WorkspaceData } from "../../Alfred_Backend/src/workspace/data.ts";
import type { AccountProfile } from "../../Alfred_Backend/src/workspace/profile.ts";

export interface CloudSnapshot { data: WorkspaceData; profile?: AccountProfile | null; revision: number; enabled: boolean }
export const fetchCloudSnapshot = (accountId: string) => apiJson<CloudSnapshot>("/api/account/cloud-sync", { _expectedAccountId: accountId });
function refreshWorkspace() {
  window.dispatchEvent(new CustomEvent("alfred:action_executed", { detail: { actions: [{ type: "task_updated" }, { type: "note_updated" }, { type: "schedule_cleared" }] } }));
}
const checking = new Map<string, Promise<void>>();
/** Server preference is authoritative; localStorage is only an offline cache. */
export function reconcileCloudSync(accountId: string): Promise<void> {
  const existing = checking.get(accountId); if (existing) return existing;
  const request = (async () => {
    const remote = await apiJson<{ enabled: boolean }>("/api/account/cloud-sync/preference", { _expectedAccountId: accountId });
    if (getSession()?.account.id !== accountId) return;
    if (remote.enabled === cloudSyncEnabled(accountId) && (!remote.enabled || !(await readLocalWorkspace(accountId)).pendingCloudData)) return;
    if (remote.enabled) await changeCloudSync(accountId, true, true);
    else {
      // Disabling elsewhere cannot download content that was already removed.
      // Keep the durable device copy and any previously unuploaded local content.
      await activateLocalStorage(accountId); refreshWorkspace();
    }
  })().finally(() => { checking.delete(accountId); });
  checking.set(accountId, request); return request;
}
export async function changeCloudSync(accountId: string, enabled: boolean, adoptAccountPreference = false): Promise<void> {
  const start = await updateLocalWorkspace(accountId, workspace => {
    workspace.transitioning = Date.now() + 120_000;
    if (adoptAccountPreference) workspace.pendingCloudData = mergeWorkspace(workspace.data, workspace.pendingCloudData ?? emptyWorkspace());
    return structuredClone(workspace);
  });
  let accountEnabled = adoptAccountPreference;
  try {
    const remote = await fetchCloudSnapshot(accountId);
    accountEnabled = remote.enabled;
    if (adoptAccountPreference && !remote.enabled) {
      if (getSession()?.account.id === accountId) { setCloudSyncEnabled(accountId, false); refreshWorkspace(); }
      return;
    }
    const local = mergeWorkspace(start.data, start.pendingCloudData ?? emptyWorkspace());
    const data = cloudSyncEnabled(accountId) && remote.enabled && !start.pendingCloudData ? remote.data : mergeWorkspace(local, remote.data);
    const profile = !start.profile || (remote.profile && remote.profile.updatedAt > start.profile.updatedAt) ? remote.profile : start.profile;
    // Durable local copy first. A failed download/save can never clear Atlas content.
    await updateLocalWorkspace(accountId, workspace => {
      if (getSession()?.account.id !== accountId) throw new Error("Your account changed. Please retry.");
      workspace.data = data;
      // Cloud reads may replace the cache after a quota/conflict failure. Preserve
      // unuploaded device content independently until a migration actually commits.
      if (enabled) workspace.pendingCloudData = local;
      if (profile) workspace.profile = profile;
    }, true, true);
    const unchanged = adoptAccountPreference && JSON.stringify(data) === JSON.stringify(remote.data) && JSON.stringify(profile) === JSON.stringify(remote.profile);
    if (!unchanged) await apiJson("/api/account/cloud-sync", { method: "PUT", body: JSON.stringify({ enabled, revision: remote.revision, ...(enabled ? { data, ...(profile ? { profile } : {}) } : { localCopySaved: true }) }), _expectedAccountId: accountId });
    if (getSession()?.account.id !== accountId) throw new Error("Your account changed. Open this account again to check its Cloud Sync setting.");
    setCloudSyncEnabled(accountId, enabled);
    await updateLocalWorkspace(accountId, workspace => { delete workspace.pendingCloudData; }, true, true);
    window.dispatchEvent(new CustomEvent("alfred:storage-warning", { detail: "" }));
    refreshWorkspace();
  } catch (error) {
    if (adoptAccountPreference && accountEnabled && getSession()?.account.id === accountId) {
      setCloudSyncEnabled(accountId, true); refreshWorkspace();
      throw new Error(`Cloud Sync is enabled for your account, but this device’s saved content could not be uploaded. It is preserved on this device. Use “Sync this device’s saved content” in Cloud storage to retry. ${error instanceof Error ? error.message : ""}`, { cause: error });
    }
    throw error;
  } finally {
    await updateLocalWorkspace(accountId, workspace => { delete workspace.transitioning; }, true, true);
  }
}
