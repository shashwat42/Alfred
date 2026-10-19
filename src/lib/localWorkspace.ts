import { emptyWorkspace, mergeWorkspace, workspaceRequest, type WorkspaceData } from "../../Alfred_Backend/src/workspace/data.ts";
import { getSession } from "../auth/auth.ts";
import type { AccountProfile } from "../../Alfred_Backend/src/workspace/profile.ts";

export const STORAGE_MODE_EVENT = "alfred:storage-mode";
export const WORKSPACE_CHANGED_EVENT = "alfred:workspace-changed";
export interface LocalWorkspace { data: WorkspaceData; revision: number; transitioning?: number; sourceAccounts?: string[]; profile?: AccountProfile }
export const cloudSyncEnabled = (accountId?: string): boolean => {
  if (!accountId) return false;
  try { return localStorage.getItem(`alfred_cloud_sync_${accountId}`) === "true"; } catch { return false; }
};
export function setCloudSyncEnabled(accountId: string, enabled: boolean) {
  localStorage.setItem(`alfred_cloud_sync_${accountId}`, String(enabled));
  window.dispatchEvent(new Event(STORAGE_MODE_EVENT));
}
let database: Promise<IDBDatabase> | undefined;
let channel: BroadcastChannel | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!channel && typeof window.BroadcastChannel === "function") {
    channel = new window.BroadcastChannel("alfred-workspaces");
    channel.onmessage = event => {
      if (event.data?.accountId !== getSession()?.account.id) return;
      window.dispatchEvent(new CustomEvent("alfred:action_executed", { detail: { actions: [{ type: "task_updated" }, { type: "note_updated" }, { type: "schedule_cleared" }] } }));
      window.dispatchEvent(new Event("alfred:profile-changed"));
    };
  }
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("alfred-workspaces", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("accounts");
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error("Device storage is unavailable. Your data was not saved.")); };
  });
  return database;
}
export async function updateLocalWorkspace<T>(accountId: string, update: (workspace: LocalWorkspace) => T, write = true, maintenance = false): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("accounts", write ? "readwrite" : "readonly", write ? { durability: "strict" } : undefined);
    const store = transaction.objectStore("accounts");
    const request = store.get(accountId);
    let result: T;
    request.onsuccess = () => {
      try {
        const workspace = (request.result as LocalWorkspace | undefined) ?? { data: emptyWorkspace(), revision: 0 };
        if (write && (workspace.transitioning ?? 0) > Date.now() && !maintenance) throw new Error("Storage is changing. Wait for Cloud Sync to finish, then retry.");
        result = update(workspace);
        if (write) { workspace.revision++; store.put(workspace, accountId); }
      } catch (error) { transaction.abort(); reject(error); }
    };
    transaction.oncomplete = () => { resolve(result); if (write) { window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT)); channel?.postMessage({ accountId }); } };
    transaction.onabort = transaction.onerror = () => reject(new Error("Could not save to device storage. Free device space and retry; Cloud Sync has not been enabled automatically."));
  });
}
export const readLocalWorkspace = (accountId: string) => updateLocalWorkspace(accountId, workspace => workspace, false);
export async function copyGuestWorkspace(sourceId: string, targetId: string) {
  const source = await readLocalWorkspace(sourceId);
  await updateLocalWorkspace(targetId, workspace => {
    workspace.data = mergeWorkspace(workspace.data, source.data);
    workspace.profile ??= source.profile;
    workspace.sourceAccounts = [...new Set([...(workspace.sourceAccounts ?? []), sourceId, ...(source.sourceAccounts ?? [])])];
  });
  // Keep the source copy for recovery. Google sign-in never opts into cloud uploads.
}
export async function deleteLocalWorkspace(accountId: string): Promise<void> {
  const db = await openDatabase();
  const sources = (await readLocalWorkspace(accountId)).sourceAccounts ?? [];
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("accounts", "readwrite"); for (const id of [accountId, ...sources]) tx.objectStore("accounts").delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  for (const id of [accountId, ...sources]) localStorage.removeItem(`alfred_cloud_sync_${id}`);
}
export async function localWorkspaceResponse(input: string, init: RequestInit & { _expectedAccountId?: string }): Promise<Response | null> {
  // Never intercept an unrelated absolute URL, including cross-origin API calls.
  if (!/^\/api\/(tasks|notes|schedule)(?:[/?]|$)/.test(input)) return null;
  const accountId = getSession()?.account.id;
  if (!accountId || cloudSyncEnabled(accountId)) return null;
  if (init._expectedAccountId && init._expectedAccountId !== accountId) throw new Error("Your account changed. Please try again.");
  if (init.signal?.aborted) throw init.signal.reason;
  const method = (init.method ?? "GET").toUpperCase();
  const response = await updateLocalWorkspace(accountId, workspace => {
    if (getSession()?.account.id !== accountId) throw new Error("Your account changed. Please try again.");
    const payload = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    return workspaceRequest(workspace.data, new URL(input, "https://local.alfred"), method, payload);
  }, method !== "GET");
  return Response.json(response.body ?? null, { status: response.status });
}

/** Keep a device copy of successful cloud reads and writes for safe opt-out. */
export async function rememberCloudResponse(accountId: string, input: string, init: RequestInit, response: Response): Promise<void> {
  if (!response.ok || getSession()?.account.id !== accountId || !cloudSyncEnabled(accountId)) return;
  const url = new URL(input, "https://local.alfred");
  const [, , resource, id] = url.pathname.split("/");
  const kind = resource === "tasks" ? "tasks" : resource === "notes" ? "notes" : "schedule";
  const method = (init.method ?? "GET").toUpperCase();
  const body = await response.clone().json().catch(() => null);
  if (method === "GET" ? !Array.isArray(body) : method !== "DELETE" && !(body?.schedule ?? body)?._id) return;
  await updateLocalWorkspace(accountId, workspace => {
    if ((workspace.transitioning ?? 0) > Date.now()) return;
    const sanitize = (value: Record<string, unknown>) => { const row = { ...value }; delete row.accountId; delete row.__v; return row as WorkspaceData[typeof kind][number]; };
    if (method === "GET" && Array.isArray(body)) {
      const records = body.map(sanitize);
      if (kind === "schedule" && url.searchParams.has("date")) workspace.data.schedule = [...workspace.data.schedule.filter(row => row.date !== url.searchParams.get("date")), ...records];
      else if (id === "recent") workspace.data.notes = mergeWorkspace(workspace.data, { ...emptyWorkspace(), notes: records }).notes;
      else workspace.data[kind] = records;
    } else if (method === "DELETE") {
      workspace.data[kind] = workspace.data[kind].filter(row => id && id !== "clear-all" ? row._id !== id : kind === "schedule" && url.searchParams.has("date") ? row.date !== url.searchParams.get("date") : false);
    } else {
      const record = body?.schedule ?? body;
      if (record?._id) workspace.data[kind] = [...workspace.data[kind].filter(row => row._id !== record._id), sanitize(record)];
    }
  }, true, true);
}
