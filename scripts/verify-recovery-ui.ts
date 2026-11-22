import assert from "node:assert/strict";
import { createElement, act } from "react";
import { Window } from "happy-dom";
import { createServer } from "vite";

const dom = new Window({ url: "http://localhost/" });
const names = ["window", "document", "navigator", "Event", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom[name as keyof Window] });
const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-recovery-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createRoot } = await import("react-dom/client");
const host = document.createElement("div"); document.body.append(host);
const root = createRoot(host);
try {
  const { SessionRecovery } = await server.ssrLoadModule("/src/components/reliability/SessionRecovery.tsx");
  const { AuthContext } = await server.ssrLoadModule("/src/auth/authContext.ts");
  let retries = 0, guests = 0, google = 0;
  const context = { session: null, loading: false, requiresAccountChoice: false, error: "Expired credential", retry: () => { retries++; }, continueAsGuest: async () => { guests++; throw new Error("Guest service unavailable"); }, loginWithGoogle: async () => { google++; }, logout: () => {} };
  async function render() { await act(async () => { root.render(createElement(AuthContext.Provider, { value: { ...context } }, createElement(SessionRecovery, { message: context.error }))); }); }
  async function click(text: string) { const button = Array.from(host.querySelectorAll("button")).find(button => button.textContent?.endsWith(text)); assert.ok(button, `Missing action: ${text}`); await act(async () => { button.click(); }); }
  await render();
  assert.match(host.textContent!, /Your session has expired/);
  assert.doesNotMatch(host.textContent!, /Expired credential|Continue as guest|Google sign-in is optional/);
  assert.equal(host.querySelector('[role="alert"]'), null);
  await click("Retry"); assert.equal(retries, 1);
  context.loading = true; await render();
  assert.ok(host.querySelector("button:disabled")); assert.match(host.textContent!, /Trying again/);
  context.loading = false; await render();
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /Expired credential/);
  await click("Login Again");
  assert.match(host.textContent!, /Welcome back to Alfred/);
  assert.equal(host.querySelector('[role="alert"]'), null);
  await click("Continue as guest"); assert.equal(guests, 1);
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /Guest service unavailable/);
  await click("Continue with Google"); assert.equal(google, 1);
  assert.match(host.querySelector('[role="status"]')!.textContent!, /Finish signing in/);
  await click("Back to recovery"); assert.match(host.textContent!, /Your session has expired/);
  assert.equal(host.querySelector('[role="alert"]'), null);
  console.log("PASS: recovery stages, retry/loading, guest failure, Google handoff and back navigation.");
} finally {
  await act(async () => root.unmount());
  await server.close(); dom.happyDOM.abort();
  for (const name of names) { const descriptor = saved.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
