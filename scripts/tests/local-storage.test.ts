import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_STORAGE_KEY, getSession, restoreAuthSession } from "../../src/auth/auth.ts";
import { apiFetch } from "../../src/lib/api.ts";
import { readLocalWorkspace, updateLocalWorkspace, cloudSyncEnabled, deleteLocalWorkspace, copyGuestWorkspace, setCloudSyncEnabled } from "../../src/lib/localWorkspace.ts";
import { changeCloudSync, reconcileCloudSync } from "../../src/lib/cloudStorage.ts";
import { sendChatMessage } from "../../src/lib/aiChat.ts";
import { emptyWorkspace } from "../../Alfred_Backend/src/workspace/data.ts";
import { loadAccountProfile, profileDefaults, saveAccountProfile } from "../../src/lib/accountProfile.ts";
import { validProfilePicture } from "../../Alfred_Backend/src/workspace/profile.ts";

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
const win = Object.assign(new EventTarget(), { location: { search: "", pathname: "/", hash: "" } });
Object.defineProperty(globalThis, "window", { configurable: true, value: win });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
const account = "111111111111111111111111", other = "222222222222222222222222";
const login = (id = account) => storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: "fixture-token", account: { id, type: "user" } }));
const request = (path: string, method = "GET", body?: unknown) => apiFetch(`/api/${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

test("a saved local account can reopen its device workspace during a network outage", async () => {
  login(); const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { assert.equal((await restoreAuthSession(getSession()!)).account.id, account); }
  finally { globalThis.fetch = original; }
});

test("default local CRUD survives reload, makes no network calls, and isolates accounts", async () => {
  login(); const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("offline"); };
  try {
    assert.equal(cloudSyncEnabled(account), false);
    const created = await request("tasks", "POST", { task: "Offline task", priority: "high" }); assert.equal(created.status, 201);
    const task = await created.json(); assert.match(task._id, /^[a-f0-9]{24}$/);
    await request(`tasks/${task._id}/complete`, "PATCH", { completed: true });
    const note = await (await request("notes", "POST", { title: "Local", content: "Private" })).json();
    await request(`notes/${note._id}`, "PUT", { content: "Changed" });
    await request("schedule", "POST", { schedule: { date: "2026-10-20", time: "10:00", topic: "Local event" } });
    assert.equal((await (await request("schedule?date=2026-10-20")).json()).length, 1);
    assert.equal((await readLocalWorkspace(account)).data.tasks[0].completed, true);
    login(other); assert.deepEqual(await (await request("tasks")).json(), []);
    login(); assert.equal((await (await request("notes/recent?limit=4")).json())[0].content, "Changed");
    await request(`notes/${note._id}`, "DELETE"); assert.deepEqual(await (await request("notes")).json(), []);
    assert.equal(calls, 0);
    await assert.rejects(apiFetch("/api/tasks", { _expectedAccountId: other }), /account changed/);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); await deleteLocalWorkspace(other); }
});

test("cloud opt-in uploads local data; disabling durably downloads before cloud deletion", async () => {
  login(); await request("tasks", "POST", { task: "Keep this" });
  const original = globalThis.fetch; const cloud = emptyWorkspace(); let phase = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "PUT") return Response.json({ data: cloud, revision: phase, enabled: phase === 1 });
    const payload = JSON.parse(String(init.body));
    const saved = await readLocalWorkspace(account);
    assert.equal(saved.data.tasks[0].task, "Keep this");
    if (payload.enabled) { cloud.tasks = payload.data.tasks; phase = 1; }
    else { assert.equal(payload.localCopySaved, true); phase = 2; }
    return Response.json({ enabled: payload.enabled });
  };
  try {
    await changeCloudSync(account, true); assert.equal(cloudSyncEnabled(account), true); assert.equal(cloud.tasks.length, 1);
    await changeCloudSync(account, false); assert.equal(cloudSyncEnabled(account), false);
    assert.equal((await readLocalWorkspace(account)).data.tasks[0].task, "Keep this");
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); }
});

test("failed uploads preserve local data and default-local mode; concurrent edits are blocked during transition", async () => {
  login(); await request("notes", "POST", { content: "Do not lose me" });
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "PUT") return Response.json({ data: emptyWorkspace(), revision: 0, enabled: false });
    await assert.rejects(request("tasks", "POST", { task: "racing write" }), /Storage is changing/);
    return Response.json({ error: "Cloud storage is full" }, { status: 413 });
  };
  try {
    await assert.rejects(changeCloudSync(account, true), /Cloud storage is full/);
    assert.equal(cloudSyncEnabled(account), false); assert.equal((await readLocalWorkspace(account)).data.notes[0].content, "Do not lose me");
    assert.equal((await request("tasks", "POST", { task: "Works again" })).status, 201);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); }
});

test("local AI actions save to the originating device and reject a concurrent edit", async () => {
  login(); const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); assert.deepEqual(payload.localWorkspace, emptyWorkspace());
    payload.localWorkspace.tasks.push({ _id: "333333333333333333333333", task: "AI local task", priority: "normal", completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return Response.json({ message: { content: "Created" }, localWorkspace: payload.localWorkspace });
  };
  try {
    await sendChatMessage([{ role: "user", content: "add a task" }]);
    assert.equal((await readLocalWorkspace(account)).data.tasks[0].task, "AI local task");
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      await updateLocalWorkspace(account, workspace => { workspace.data.notes.push({ _id: "444444444444444444444444", title: "Concurrent", content: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); });
      return Response.json({ message: { content: "Done" }, localWorkspace: payload.localWorkspace });
    };
    await assert.rejects(sendChatMessage([{ role: "user", content: "another task" }]), /workspace changed/);
    assert.equal((await readLocalWorkspace(account)).data.notes.length, 1);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); }
});

test("a failed durable download never sends the cloud deletion request", async () => {
  login(); const originalFetch = globalThis.fetch, originalPut = IDBObjectStore.prototype.put;
  let puts = 0, deletes = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
    if (++puts === 2) throw new DOMException("Device full", "QuotaExceededError");
    return originalPut.apply(this, args);
  };
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "PUT") deletes++;
    return Response.json({ data: emptyWorkspace(), enabled: true, revision: 0 });
  };
  try { await assert.rejects(changeCloudSync(account, false)); assert.equal(deletes, 0); }
  finally { globalThis.fetch = originalFetch; IDBObjectStore.prototype.put = originalPut; await deleteLocalWorkspace(account); }
});

test("guest linking copies locally without opting in and account deletion clears its linked recovery copy", async () => {
  login(); await request("notes", "POST", { content: "Guest workspace" });
  await copyGuestWorkspace(account, other); login(other);
  assert.equal((await readLocalWorkspace(other)).data.notes[0].content, "Guest workspace");
  assert.equal(cloudSyncEnabled(other), false);
  await deleteLocalWorkspace(other);
  assert.deepEqual((await readLocalWorkspace(account)).data, emptyWorkspace());
  assert.deepEqual((await readLocalWorkspace(other)).data, emptyWorkspace());
});

test("editable names and photos stay local, persist by account, and support explicit removal", async () => {
  login(); const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Local profile must not upload."); };
  try {
    assert.equal(profileDefaults({ token: "x", account: { id: account, type: "guest" } }).name, "Guest");
    assert.deepEqual(profileDefaults({ token: "x", account: { id: account, type: "user", name: "Google Name", picture: "https://example.test/google.png" } }), { name: "Google Name", picture: "https://example.test/google.png" });
    const picture = "data:image/png;base64,aGVsbG8=";
    await saveAccountProfile(account, "  My account  ", picture);
    assert.equal((await loadAccountProfile(account))?.name, "My account");
    assert.equal((await loadAccountProfile(account))?.picture, picture);
    assert.equal((await readLocalWorkspace(other)).profile, undefined);
    await saveAccountProfile(account, "Updated", null);
    assert.equal((await loadAccountProfile(account))?.picture, null);
    await assert.rejects(saveAccountProfile(account, " ", null), /account name/);
    assert.equal(validProfilePicture("data:image/svg+xml;base64,PHN2Zz4="), false);
    assert.equal(validProfilePicture("http://example.test/photo.png"), false);
    assert.equal(validProfilePicture("data:image/png;base64," + "a".repeat(350000)), false);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); }
});

test("account preference enables another device, merges its local data and follows remote disable", async () => {
  login(); await request("tasks", "POST", { task: "Only on this device" });
  const original = globalThis.fetch; let enabled = true, uploads = 0;
  let cloud = emptyWorkspace();
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/preference")) return Response.json({ enabled });
    if (init?.method === "PUT") { uploads++; cloud = JSON.parse(String(init.body)).data; return Response.json({ enabled: true }); }
    return Response.json({ data: cloud, enabled, revision: 1 });
  };
  try {
    await Promise.all([reconcileCloudSync(account), reconcileCloudSync(account)]);
    assert.equal(cloudSyncEnabled(account), true); assert.equal(uploads, 1);
    assert.equal(cloud.tasks[0].task, "Only on this device");
    assert.equal((await readLocalWorkspace(account)).pendingCloudData, undefined);
    enabled = false; await reconcileCloudSync(account);
    assert.equal(cloudSyncEnabled(account), false); assert.equal(uploads, 1, "observing another device’s opt-out must not write a preference");
    assert.equal((await readLocalWorkspace(account)).data.tasks[0].task, "Only on this device");
    globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(reconcileCloudSync(account)); assert.equal(cloudSyncEnabled(account), false);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); }
});

test("failed adoption keeps the account enabled and retains local content through cloud cache replacement", async () => {
  login(); await request("tasks", "POST", { task: "Unuploaded local task" });
  const original = globalThis.fetch; let fail = true;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/preference")) return Response.json({ enabled: true });
    if (String(url).endsWith("/api/tasks")) return Response.json([]);
    if (init?.method === "PUT") {
      if (fail) return Response.json({ error: "Cloud full" }, { status: 413 });
      assert.equal(JSON.parse(String(init.body)).data.tasks[0].task, "Unuploaded local task");
      return Response.json({ enabled: true });
    }
    return Response.json({ data: emptyWorkspace(), enabled: true, revision: 0 });
  };
  try {
    await assert.rejects(reconcileCloudSync(account), /preserved on this device/);
    assert.equal(cloudSyncEnabled(account), true);
    await request("tasks"); assert.equal((await readLocalWorkspace(account)).data.tasks.length, 0);
    assert.equal((await readLocalWorkspace(account)).pendingCloudData?.tasks[0].task, "Unuploaded local task");
    fail = false; await reconcileCloudSync(account);
    assert.equal((await readLocalWorkspace(account)).pendingCloudData, undefined);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); }
});

test("preference reconciliation cannot reverse a later account opt-out or change a switched account", async () => {
  login(); const original = globalThis.fetch; let uploads = 0;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "PUT") uploads++;
    return String(url).endsWith("/preference") ? Response.json({ enabled: true }) : Response.json({ enabled: false, data: emptyWorkspace(), revision: 1 });
  };
  try {
    await reconcileCloudSync(account); assert.equal(cloudSyncEnabled(account), false); assert.equal(uploads, 0);
    globalThis.fetch = async () => { login(other); return Response.json({ enabled: true }); };
    await assert.rejects(reconcileCloudSync(account), /account changed/);
    assert.equal(cloudSyncEnabled(account), false); assert.equal(cloudSyncEnabled(other), false);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); await deleteLocalWorkspace(other); login(); }
});

test("server opt-out restores unuploaded content before a stale cloud client retries locally", async () => {
  login(); await request("tasks", "POST", { task: "Pending device content" });
  await updateLocalWorkspace(account, workspace => { workspace.pendingCloudData = structuredClone(workspace.data); workspace.data = emptyWorkspace(); });
  setCloudSyncEnabled(account, true); const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: "CLOUD_SYNC_DISABLED" }, { status: 409 });
  try {
    const rows = await (await request("tasks")).json();
    assert.equal(rows[0].task, "Pending device content"); assert.equal(cloudSyncEnabled(account), false);
    assert.equal((await readLocalWorkspace(account)).pendingCloudData, undefined);
  } finally { globalThis.fetch = original; await deleteLocalWorkspace(account); }
});
