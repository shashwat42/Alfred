import { apiJson } from "./api.ts";
import { getSession } from "../auth/auth.ts";
import { cloudSyncEnabled, setCloudSyncEnabled, updateLocalWorkspace } from "./localWorkspace.ts";
import { mergeWorkspace, type WorkspaceData } from "../../Alfred_Backend/src/workspace/data.ts";
import type { AccountProfile } from "../../Alfred_Backend/src/workspace/profile.ts";

export interface CloudSnapshot { data: WorkspaceData; profile?: AccountProfile | null; revision: number; enabled: boolean }
export const fetchCloudSnapshot = (accountId: string) => apiJson<CloudSnapshot>("/api/account/cloud-sync", { _expectedAccountId: accountId });
export async function changeCloudSync(accountId: string, enabled: boolean): Promise<void> {
  const start = await updateLocalWorkspace(accountId, workspace => {
    workspace.transitioning = Date.now() + 120_000;
    return structuredClone(workspace);
  });
  try {
    const remote = await fetchCloudSnapshot(accountId);
    const data = cloudSyncEnabled(accountId) && remote.enabled ? remote.data : mergeWorkspace(start.data, remote.data);
    const profile = !start.profile || (remote.profile && remote.profile.updatedAt > start.profile.updatedAt) ? remote.profile : start.profile;
    // Durable local copy first. A failed download/save can never clear Atlas content.
    await updateLocalWorkspace(accountId, workspace => {
      if (getSession()?.account.id !== accountId) throw new Error("Your account changed. Please retry.");
      workspace.data = data;
      if (profile) workspace.profile = profile;
    }, true, true);
    await apiJson("/api/account/cloud-sync", { method: "PUT", body: JSON.stringify({ enabled, revision: remote.revision, ...(enabled ? { data, ...(profile ? { profile } : {}) } : { localCopySaved: true }) }), _expectedAccountId: accountId });
    if (getSession()?.account.id !== accountId) throw new Error("Your account changed. Open this account again to check its Cloud Sync setting.");
    setCloudSyncEnabled(accountId, enabled);
    window.dispatchEvent(new CustomEvent("alfred:action_executed", { detail: { actions: [{ type: "task_updated" }, { type: "note_updated" }, { type: "schedule_cleared" }] } }));
  } finally {
    await updateLocalWorkspace(accountId, workspace => { delete workspace.transitioning; }, true, true);
  }
}
