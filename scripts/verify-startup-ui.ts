import assert from "node:assert/strict";
import { createElement, act, Fragment } from "react";
import { Window } from "happy-dom";
import { createServer } from "vite";

const dom = new Window({ url: "http://localhost:5173/" });
const names = ["window", "document", "navigator", "localStorage", "CustomEvent", "StorageEvent", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) {
  const value = name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "requestAnimationFrame" || name === "cancelAnimationFrame" ? dom[name].bind(dom) : dom[name as keyof Window];
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const originalFetch = globalThis.fetch;
const requests: string[] = [];
const guest = { token: "isolated-guest", account: { id: "existing-guest", type: "guest" } };
let googleFailure = false;
globalThis.fetch = async url => {
  const path = new URL(String(url)).pathname;
  requests.push(path);
  if (path === "/health") return Response.json({ mode: "development" });
  if (path === "/auth/guest" || path === "/auth/session") return Response.json(guest);
  if (path === "/auth/prepare" && googleFailure) return Response.json({ error: "Google unavailable" }, { status: 503 });
  if (path === "/api/account") return Response.json({ onboardingCompleted: false, storage: {}, ai: {} });
  throw new Error(`Unexpected startup request: ${path}`);
};
const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-startup-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createRoot } = await import("react-dom/client");
let roots: ReturnType<typeof createRoot>[] = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 70));
try {
  const { AuthProvider } = await server.ssrLoadModule("/src/auth/AuthContext.tsx");
  const { ApplicationBoundary } = await server.ssrLoadModule("/src/components/reliability/ApplicationBoundary.tsx");
  const { OverlaySessionBoundary } = await server.ssrLoadModule("/src/components/OverlaySessionBoundary.tsx");
  const { NotificationHost } = await server.ssrLoadModule("/src/components/reliability/Notifications.tsx");
  const auth = await server.ssrLoadModule("/src/auth/auth.ts");
  const api = await server.ssrLoadModule("/src/lib/api.ts");
  async function unmount() {
    await act(async () => { roots.forEach(root => root.unmount()); await settle(); });
    roots = []; dom.document.body.innerHTML = "";
  }
  async function mount() {
    dom.document.body.innerHTML = '<div id="main"></div><div id="overlay"></div>';
    roots = [createRoot(document.getElementById("main")!), createRoot(document.getElementById("overlay")!)];
    await act(async () => {
      roots[0].render(createElement(Fragment, null, createElement(NotificationHost), createElement(AuthProvider, null, createElement(ApplicationBoundary, null, createElement("div", null, "Workspace")))));
      roots[1].render(createElement(AuthProvider, null, createElement(OverlaySessionBoundary, null, createElement("div", null, "Overlay ready"))));
      await settle();
    });
    await act(settle);
  }
  const main = () => document.getElementById("main")!;
  const choice = (text: string) => Array.from(main().querySelectorAll("button")).find(button => button.textContent?.includes(text))!;
  const noTour = () => assert.equal(main().querySelector(".onboarding-layer"), null);

  await mount();
  assert.ok(choice("Continue as guest")); assert.ok(choice("Continue with Google")); noTour();
  assert.equal(requests.filter(path => path.startsWith("/auth/")).length, 0);
  assert.equal(await api.ensureToken(), null);
  assert.equal(requests.filter(path => path === "/auth/guest").length, 0);
  assert.doesNotMatch(document.getElementById("overlay")!.textContent!, /Overlay ready/);
  await act(async () => { choice("Continue as guest").click(); await settle(); });
  await act(settle);
  assert.equal(requests.filter(path => path === "/auth/guest").length, 1);
  assert.ok(main().querySelector(".onboarding-layer"));
  assert.equal(localStorage.getItem(auth.GUEST_CHOICE_KEY), guest.account.id);
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: auth.GUEST_CHOICE_KEY })); await settle(); });
  assert.match(document.getElementById("overlay")!.textContent!, /Overlay ready/);

  await unmount(); await mount();
  assert.equal(main().querySelector(".welcome-screen"), null, "Confirmed returning guests should not be asked again");
  assert.equal(requests.filter(path => path === "/auth/guest").length, 1);

  await unmount(); localStorage.removeItem(auth.GUEST_CHOICE_KEY); requests.length = 0;
  await mount();
  assert.ok(choice("Continue as guest")); noTour();
  assert.equal(requests.filter(path => path === "/api/account").length, 0);
  await act(async () => { choice("Continue as guest").click(); await settle(); }); await act(settle);
  assert.equal(requests.filter(path => path === "/auth/guest").length, 0, "Legacy guest confirmation must preserve the existing account");
  assert.equal(auth.getSession().account.id, guest.account.id);
  assert.ok(main().querySelector(".onboarding-layer"));

  await unmount(); localStorage.clear(); requests.length = 0; googleFailure = true;
  await mount();
  await act(async () => { choice("Continue with Google").click(); await settle(); }); await act(settle);
  assert.ok(requests.includes("/auth/prepare"), JSON.stringify(requests));
  assert.match(document.body.textContent!, /Google unavailable/); noTour();
  assert.ok(choice("Continue as guest"));
  assert.equal(requests.filter(path => path === "/api/account").length, 0);
  await act(async () => { auth.setSession({ token: "isolated-google", account: { id: "google-user", type: "user" } }); await settle(); }); await act(settle);
  assert.equal(main().querySelector(".welcome-screen"), null);
  assert.ok(main().querySelector(".onboarding-layer"));
  console.log("PASS: main/overlay startup waits for a choice; guest continuation, reload, legacy session preservation and Google failure/success gate the tour correctly.");
} finally {
  await act(async () => { roots.forEach(root => root.unmount()); });
  globalThis.fetch = originalFetch;
  await server.close();
  await dom.happyDOM.abort(); dom.close();
  for (const name of names) { const descriptor = saved.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
