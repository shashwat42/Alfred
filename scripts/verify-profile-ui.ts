import assert from "node:assert/strict";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { indexedDB } from "fake-indexeddb";
import { createServer } from "vite";
const dom = new Window({ url: "http://localhost:5173/" });
const names = ["window", "document", "navigator", "localStorage", "Event", "CustomEvent", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT", "indexedDB"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "indexedDB" ? indexedDB : dom[name as keyof Window] });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Local profile editing must not upload."); };
const photo = "data:image/png;base64,aGVsbG8=";
const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-profile-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createRoot } = await import("react-dom/client");
document.body.innerHTML = '<div id="root"></div>'; const root = createRoot(document.getElementById("root")!);
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
try {
  const { AuthContext } = await server.ssrLoadModule("/src/auth/authContext.ts");
  const { ProfileEditor } = await server.ssrLoadModule("/src/components/dashboard/ProfileEditor.tsx");
  const { readLocalWorkspace, updateLocalWorkspace, deleteLocalWorkspace } = await server.ssrLoadModule("/src/lib/localWorkspace.ts");
  const guest = { token: "fixture", account: { id: "111111111111111111111111", type: "guest" } };
  const render = async (session: typeof guest) => {
    localStorage.setItem("alfred_session", JSON.stringify(session));
    await act(async () => root.render(createElement(AuthContext.Provider, { value: { session } }, createElement(ProfileEditor)))); await settle();
  };
  await render(guest); assert.equal(document.querySelector<HTMLInputElement>("#profile-name")!.value, "Guest");
  assert.equal(document.querySelector('input[type="file"]'), null, "Custom photo upload is removed");
  assert.equal(document.querySelector('img[alt="Google account photo"]'), null, "Guests use initials");
  const name = document.querySelector<HTMLInputElement>("#profile-name")!;
  await act(async () => { Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(name, "My guest account"); name.dispatchEvent(new dom.Event("input", { bubbles: true })); });
  await act(async () => { document.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true })); }); await settle();
  assert.equal((await readLocalWorkspace(guest.account.id)).profile.name, "My guest account");
  assert.equal((await readLocalWorkspace(guest.account.id)).profile.picture, null);
  const google = { token: "fixture", account: { id: "222222222222222222222222", type: "user", name: "Google Name", picture: "https://example.test/photo.png" } };
  await render(google); assert.equal(document.querySelector<HTMLInputElement>("#profile-name")!.value, "Google Name");
  assert.equal(document.querySelector<HTMLImageElement>('img[alt="Google account photo"]')?.src, google.account.picture);
  for (const picture of [photo, null]) {
    await updateLocalWorkspace(google.account.id, (workspace: { profile?: unknown }) => { workspace.profile = { name: "Saved name", picture, updatedAt: new Date().toISOString() }; });
    await act(async () => window.dispatchEvent(new Event("alfred:profile-changed"))); await settle();
    assert.equal(document.querySelector<HTMLInputElement>("#profile-name")!.value, "Saved name", "Custom names are preserved");
    assert.equal(document.querySelector<HTMLImageElement>('img[alt="Google account photo"]')?.src, google.account.picture, "Saved custom or removed photos cannot override Google");
  }
  assert.equal(document.querySelector('input[type="file"]'), null);
  assert.ok(!document.body.textContent!.includes("Remove photo"));
  assert.ok(!document.body.textContent!.includes("Photos are cropped"));
  await render({ token: "fixture", account: { ...google.account, picture: undefined } });
  assert.equal(document.querySelector('img[alt="Google account photo"]'), null, "Missing Google photos fall back to initials");
  await deleteLocalWorkspace(guest.account.id); await deleteLocalWorkspace(google.account.id);
  console.log("PASS: Editable names, Google-only photos, initials fallback, ignored legacy photo overrides, removed upload controls and account isolation.");
} finally {
  await act(async () => root.unmount()); await server.close(); await dom.happyDOM.close(); globalThis.fetch = originalFetch;
  for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
