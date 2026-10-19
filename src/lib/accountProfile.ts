import type { AuthSession } from "../auth/auth.ts";
import { getSession } from "../auth/auth.ts";
import { apiJson } from "./api.ts";
import { cloudSyncEnabled, readLocalWorkspace, updateLocalWorkspace } from "./localWorkspace.ts";
import { validProfileName, validProfilePicture, type AccountProfile } from "../../Alfred_Backend/src/workspace/profile.ts";

export const PROFILE_CHANGED_EVENT = "alfred:profile-changed";
export function profileDefaults(session: AuthSession | null) {
  return { name: session?.account.type === "user" ? session.account.name?.trim() || "Google account" : "Guest", picture: session?.account.type === "user" && validProfilePicture(session.account.picture) ? session.account.picture : null };
}
export async function saveAccountProfile(accountId: string, name: string, picture: string | null): Promise<void> {
  const cleanName = name.trim();
  if (!validProfileName(cleanName)) throw new Error("Use an account name between 1 and 100 characters.");
  if (!validProfilePicture(picture)) throw new Error("Choose a supported profile photo.");
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

export async function prepareProfilePicture(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP photo smaller than 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext("2d"); if (!context) throw new Error("This device could not prepare the photo.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("Choose a valid photo.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    context.fillStyle = "#18181b"; context.fillRect(0, 0, 512, 512);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
    for (const quality of [.92, .85, .78, .7]) {
      const encoded = canvas.toDataURL("image/jpeg", quality);
      if (Math.ceil((encoded.length - encoded.indexOf(",") - 1) * 3 / 4) <= 200 * 1024 && validProfilePicture(encoded)) return encoded;
    }
    throw new Error("This photo could not be compressed below 200 KB. Choose a simpler image.");
  } finally { URL.revokeObjectURL(url); }
}
