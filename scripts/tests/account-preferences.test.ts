import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_STORAGE_KEY } from "../../src/auth/auth.ts";
import { getAccountPreferences, saveAccountPreferences, syncAccountPreferences } from "../../src/lib/accountPreferences.ts";
import { defaultPreferences } from "../../Alfred_Backend/src/workspace/preferences.ts";

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { location: { search: "", pathname: "/", hash: "" } }) });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
const account = "111111111111111111111111", other = "222222222222222222222222";
const login = (id = account) => storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: "fixture", account: { id, type: "user" } }));

test("legacy device preferences migrate once without leaking into a second account", () => {
  values.clear(); login(); storage.setItem("alfred_overlay_mode", "voice");
  assert.equal(getAccountPreferences().overlayMode, "voice");
  login(other); assert.equal(getAccountPreferences().overlayMode, "quick_input");
});

test("preferences remain separate by account and do not upload without Cloud Sync", async () => {
  values.clear(); login(); const original = fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must stay local"); };
  try {
    saveAccountPreferences({ overlayMode: "voice", launchOnStartup: true });
    login(other); assert.deepEqual(getAccountPreferences(), defaultPreferences);
    saveAccountPreferences({ silenceTimeout: 2500 });
    login(); assert.equal(getAccountPreferences().overlayMode, "voice"); assert.equal(getAccountPreferences().silenceTimeout, 1500);
    await syncAccountPreferences(account); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("sync retries pending edits, preserves edits during a request, and adopts remote fields", async () => {
  values.clear(); login(); saveAccountPreferences({ overlayMode: "voice" });
  storage.setItem(`alfred_cloud_sync_${account}`, "true");
  const original = fetch; let release!: () => void; let calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (_input, init) => {
    calls++;
    if (calls === 1) await gate;
    const patch = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ ...defaultPreferences, sidebarCollapsed: true, ...patch });
  };
  try {
    const sync = syncAccountPreferences(account);
    saveAccountPreferences({ silenceTimeout: 2000 });
    release(); await sync;
    assert.equal(calls, 2); assert.equal(getAccountPreferences().silenceTimeout, 2000); assert.equal(getAccountPreferences().sidebarCollapsed, true);
    assert.deepEqual(JSON.parse(values.get(`alfred_preferences_${account}`)!).pending, {});
    globalThis.fetch = async () => { throw new Error("offline"); };
    saveAccountPreferences({ overlayMode: "quick_input" });
    await assert.rejects(syncAccountPreferences(account));
    assert.equal(JSON.parse(values.get(`alfred_preferences_${account}`)!).pending.overlayMode, "quick_input");
  } finally { globalThis.fetch = original; }
});

test("late sync cannot replace preferences after an account switch", async () => {
  values.clear(); login(); storage.setItem(`alfred_cloud_sync_${account}`, "true");
  const original = fetch; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => { await gate; return Response.json({ ...defaultPreferences, overlayMode: "voice" }); };
  try {
    const sync = syncAccountPreferences(account); login(other); release();
    await assert.rejects(sync, /account changed/); assert.deepEqual(getAccountPreferences(), defaultPreferences);
  } finally { globalThis.fetch = original; }
});
