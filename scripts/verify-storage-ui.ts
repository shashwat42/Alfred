import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { Window } from "happy-dom";
import { createServer } from "vite";
import { indexedDB } from "fake-indexeddb";

const dom = new Window({ url: "http://localhost:5173/" });
const names = ["window", "document", "navigator", "localStorage", "Event", "CustomEvent", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT", "indexedDB"] as const;
const original = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "indexedDB" ? indexedDB : dom[name as keyof Window] });
const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-storage-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createRoot } = await import("react-dom/client");
document.body.innerHTML = '<div id="root"></div>';
const root = createRoot(document.getElementById("root")!);
const previousFetch = globalThis.fetch;
const requests: string[] = [];
const session = { token: "isolated-test-token", account: { id: "111111111111111111111111", type: "user" } };
localStorage.setItem("alfred_session", JSON.stringify(session));
let fail = false, enabled = false;
const data = { tasks: [], notes: [], schedule: [] };
globalThis.fetch = async (url, init) => {
  requests.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
  if (init?.method === "PUT") {
    if (fail) return Response.json({ error: "Cloud storage is full" }, { status: 413 });
    enabled = JSON.parse(String(init.body)).enabled; return Response.json({ enabled });
  }
  return Response.json({ data, revision: 0, enabled });
};
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
try {
  const { AuthContext } = await server.ssrLoadModule("/src/auth/authContext.ts");
  const { CloudStorageSettings } = await server.ssrLoadModule("/src/components/dashboard/CloudStorageSettings.tsx");
  const { ScheduleNotificationSettings } = await server.ssrLoadModule("/src/components/dashboard/ScheduleNotificationSettings.tsx");
  const { Usage } = await server.ssrLoadModule("/src/components/reliability/Usage.tsx");
  const { StorageRuntime } = await server.ssrLoadModule("/src/components/StorageRuntime.tsx");
  await act(async () => root.render(createElement(AuthContext.Provider, { value: { session } }, createElement(Fragment, null,
    createElement(CloudStorageSettings, { refresh() {} }), createElement(ScheduleNotificationSettings),
    createElement(Usage, { data: { storage: { usedBytes: 0, limitBytes: 10_000_000, remainingBytes: 10_000_000, overQuota: false }, ai: { daily: { used: 0, limit: null }, monthly: { used: 0, limit: null } } } }),
  ))));
  const checkbox = () => document.querySelector<HTMLInputElement>("#cloud-sync-enabled")!;
  assert.equal(checkbox().checked, false); assert.equal(requests.length, 0);
  assert.match(document.body.textContent!, /Local storage is active/); assert.match(document.body.textContent!, /Cloud storage/);
  assert.equal(document.querySelector("#schedule-notifications-enabled"), null);
  fail = true;
  await act(async () => checkbox().click()); await settle();
  assert.equal(checkbox().checked, false); assert.match(document.body.textContent!, /Cloud storage is full/);
  // Test enabling without mounting the cloud reminder form's independent network lifecycle.
  await act(async () => root.render(createElement(AuthContext.Provider, { value: { session } }, createElement(CloudStorageSettings, { refresh() {} }))));
  fail = false; await act(async () => checkbox().click()); await settle();
  assert.equal(checkbox().checked, true); assert.match(document.body.textContent!, /Cloud Sync is enabled/);
  await act(async () => checkbox().click()); await settle(); assert.equal(checkbox().checked, false);
  assert.equal(requests.filter(value => value.startsWith("PUT")).length, 3);
  await act(async () => root.render(createElement(AuthContext.Provider, { value: { session } }, createElement(Fragment, null,
    createElement(CloudStorageSettings, { refresh() {} }), createElement(StorageRuntime),
  )))); await settle();
  enabled = true; await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle();
  assert.equal(checkbox().checked, true); assert.match(document.body.textContent!, /account on all devices/);
  enabled = false; await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle();
  assert.equal(checkbox().checked, false);
  console.log("PASS: Local default, no implicit uploads or cloud reminders, cloud storage labels, opt-in, quota failure, and opt-out.");
} finally {
  await act(async () => root.unmount()); await server.close(); await dom.happyDOM.close(); globalThis.fetch = previousFetch;
  for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
