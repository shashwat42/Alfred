import type { AuthSession } from "../auth/auth.ts";
import { getSession } from "../auth/auth.ts";
import { apiJson } from "./api.ts";
import { cloudSyncEnabled, readLocalWorkspace, updateLocalWorkspace } from "./localWorkspace.ts";
import { validProfileName, validProfilePicture, type AccountProfile } from "../../Alfred_Backend/src/workspace/profile.ts";

export const PROFILE_CHANGED_EVENT = "alfred:profile-changed";
export function profileDefaults(session: AuthSession | null) {
  return { name: session?.account.type === "user" ? session.account.name?.trim() || "Google account" : "Guest", picture: session?.account.type === "user" && validProfilePicture(session.account.picture) ? session.account.picture : null };
}
export async function saveAccountProfile(accountId: string, name: string): Promise<void> {
  const cleanName = name.trim();
  if (!validProfileName(cleanName)) throw new Error("Use an account name between 1 and 100 characters.");
  const session = getSession();
  if (session?.account.id !== accountId) throw new Error("Your account changed. Please try again.");
  const picture = profileDefaults(session).picture;
  const profile: AccountProfile = { name: cleanName, picture, updatedAt: new Date().toISOString() };
  await updateLocalWorkspace(accountId, workspace => {
    if (getSession()?.account.id !== accountId) throw new Error("Your account changed. Please try again.");
    workspace.profile = profile;
  });
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
  if (cloudSyncEnabled(accountId)) {
    try { await apiJson("/api/account/profile", { method: "PUT", body: JSON.stringify(profile), _expectedAccountId: accountId }); }
    catch (error) { throw new Error(`Saved on this device, but your cloud profile could not be updated. ${error instanceof Error ? error.message : "Please retry."}`, { cause: error }); }
  }
}
export async function loadAccountProfile(accountId: string, fromCloud = false) {
  let profile = (await readLocalWorkspace(accountId)).profile;
  if (fromCloud && cloudSyncEnabled(accountId)) {
    try {
      const remote = await apiJson<AccountProfile | null>("/api/account/profile", { _expectedAccountId: accountId });
      if (remote && (!profile || remote.updatedAt > profile.updatedAt)) {
        profile = await updateLocalWorkspace(accountId, workspace => {
          if (getSession()?.account.id !== accountId) throw new Error("Your account changed.");
          if (!workspace.profile || remote.updatedAt > workspace.profile.updatedAt) workspace.profile = remote;
          return workspace.profile;
        });
      }
    } catch { /* The saved device profile remains available during cloud outages. */ }
  }
  return profile;
}
