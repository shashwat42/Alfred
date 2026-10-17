import assert from "node:assert/strict";
import { test } from "node:test";
import { installationSecret, notificationRequest, notificationPermission, openScheduleTarget, androidNotificationRequest, deliverDesktopReminder, canOpenNotificationSettings, openNotificationSettings, NOTIFICATION_OPEN_EVENT } from "../../src/lib/scheduleNotifications.ts";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { startScheduleNotificationCoordinator } from "../../src/lib/scheduleNotificationCoordinator.ts";

const accountId = "111111111111111111111111";
const scheduleId = "333333333333333333333333";
function browser(userAgent = "Windows") {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout, location: { search: "", pathname: "/", hash: "" }, history: { replaceState() {} }, isTauri: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  storage.setItem("alfred_session", JSON.stringify({ token: "current-token", account: { id: accountId, type: "user" } }));
  return { win, storage };
}
test("installation identity is random, stable locally, and regenerated for corrupt storage", () => {
  const { storage } = browser();
  const first = installationSecret(); assert.match(first, /^[a-f0-9]{64}$/); assert.equal(installationSecret(), first);
  storage.setItem("alfred_schedule_notification_installation", "corrupt");
  assert.notEqual(installationSecret(), first);
});
test("notification requests preserve account sessions and never create a guest on 401", async () => {
  browser(); const saved = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer current-token"); return new Response("", { status: 401 }); };
  try { await assert.rejects(notificationRequest("/preferences", accountId), /401/); assert.equal(calls, 1); }
  finally { globalThis.fetch = saved; }
});
test("notification API rejects an account switch before sending a request", async () => {
  browser(); const saved = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try { await assert.rejects(notificationRequest("/preferences", "different-account"), /account changed/); assert.equal(calls, 0); }
  finally { globalThis.fetch = saved; }
});
test("notification taps navigate to a validated schedule on the current account", () => {
  const { win } = browser(); const targets: unknown[] = [];
  win.addEventListener(NOTIFICATION_OPEN_EVENT, e => targets.push((e as CustomEvent).detail));
  openScheduleTarget({ scheduleId, date: "2026-10-17", accountId });
  openScheduleTarget({ scheduleId, date: "2026-10-17", accountId: "other" });
  openScheduleTarget({ scheduleId: "bad", date: "2026-10-17", accountId });
  assert.equal(targets.length, 1);
});
test("web previews report unavailable and cannot initiate desktop delivery", async () => {
  browser(); assert.equal(await notificationPermission(), "unavailable");
  await deliverDesktopReminder({ key: "key", scheduleId, date: "2026-10-17", title: "Title", body: "Time", kind: "lead", eventAt: 1, dueAt: 0 }, accountId);
});
test("Android permissions and native failures are separate from destination settings", async () => {
  const { win } = browser("Android");
  let granted = false;
  const bridge: { onmessage: ((e: { data: string }) => void) | null; postMessage: (text: string) => void } = { onmessage: null, postMessage(text) {
    const message = JSON.parse(text); bridge.onmessage?.({ data: JSON.stringify({ id: message.id, granted, ...(message.type === "sync" ? { error: "native failed" } : {}) }) });
  } };
  Object.assign(win, { AlfredScheduleNotifications: bridge });
  assert.equal(await notificationPermission(), "denied");
  granted = true; assert.equal(await notificationPermission(), "granted");
  await assert.rejects(androidNotificationRequest("sync"), /native failed/);
});
test("desktop adapter respects denied permission and invokes native delivery with a schedule action", async () => {
  const { win } = browser(); win.isTauri = true;
  const permission = { permission: "denied" };
  Object.assign(win, { Notification: permission });
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockIPC((cmd, args) => { calls.push({ cmd, args }); });
  const reminder = { key: "key", scheduleId, date: "2026-10-17", title: "Call Sam", body: "10:00 UTC", kind: "lead" as const, eventAt: 1, dueAt: 0 };
  try {
    await deliverDesktopReminder(reminder, accountId); assert.equal(calls.length, 0);
    permission.permission = "granted";
    await deliverDesktopReminder(reminder, accountId);
    assert.equal(calls.length, 1); assert.equal(calls[0]!.cmd, "plugin:notification|notify");
    assert.deepEqual(calls[0]!.args, { options: { title: reminder.title, body: reminder.body, sound: "Default", extra: { scheduleId, date: reminder.date, accountId } } });
    await deliverDesktopReminder(reminder, "other-account"); assert.equal(calls.length, 1);
  } finally { clearMocks(); }
});
test("Windows notification settings action invokes the native OS settings URI", async () => {
  const { win } = browser(); win.isTauri = true;
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockIPC((cmd, args) => { calls.push({ cmd, args }); });
  try {
    assert.equal(canOpenNotificationSettings(), true);
    await openNotificationSettings();
    assert.deepEqual(calls, [{ cmd: "plugin:opener|open_url", args: { url: "ms-settings:notifications", with: undefined } }]);
  } finally { clearMocks(); }
});
test("OS settings action is unavailable in a browser and surfaces native open failures", async () => {
  browser(); assert.equal(canOpenNotificationSettings(), false);
  await assert.rejects(openNotificationSettings(), /operating system/);
  const { win } = browser(); win.isTauri = true;
  mockIPC(() => { throw new Error("OS settings launch failed"); });
  try { await assert.rejects(openNotificationSettings(), /OS settings launch failed/); }
  finally { clearMocks(); }
});
test("coordinator prevents overlapping polls and stops native delivery on sign-out", async () => {
  const { win, storage } = browser(); win.isTauri = true;
  Object.assign(win, { Notification: { permission: "granted" } });
  let tick: (() => void) | undefined; let cleared = false;
  Object.assign(win, { setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: () => { cleared = true; } });
  let completeSync!: (response: Response) => void;
  let started!: () => void;
  const syncStarted = new Promise<void>(resolve => { started = resolve; });
  const delayedSync = new Promise<Response>(resolve => { completeSync = resolve; });
  let delivered!: () => void;
  const delivery = new Promise<void>(resolve => { delivered = resolve; });
  let syncs = 0, notifications = 0, deletions = 0;
  const savedFetch = globalThis.fetch;
  const dueAt = Date.now();
  const reminder = { key: `${scheduleId}:${dueAt + 600000}:lead`, scheduleId, date: "2026-10-17", title: "Call Sam", body: "10:00 UTC", kind: "lead", dueAt, eventAt: dueAt + 600000 };
  globalThis.fetch = async (url, init) => {
    if (init?.method === "DELETE") { deletions++; return new Response(null, { status: 204 }); }
    if (String(url).endsWith("/devices")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/sync")) { syncs++; started(); return delayedSync; }
    if (String(url).endsWith("/claim")) return Response.json(reminder);
    throw new Error("Unexpected request");
  };
  mockIPC(cmd => { if (cmd === "plugin:notification|notify") { notifications++; delivered(); } });
  const stop = startScheduleNotificationCoordinator({ token: "current-token", account: { id: accountId, type: "user" } });
  try {
    await syncStarted; tick?.(); tick?.(); assert.equal(syncs, 1);
    completeSync(Response.json({ preferences: {}, reminders: [reminder], next: null }));
    await delivery; assert.equal(notifications, 1);
    storage.removeItem("alfred_session"); stop();
    tick?.(); assert.equal(notifications, 1); assert.equal(syncs, 1);
    assert.equal(cleared, true); assert.equal(deletions, 1);
  } finally { stop(); globalThis.fetch = savedFetch; clearMocks(); }
});
