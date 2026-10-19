import assert from "node:assert/strict";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { indexedDB } from "fake-indexeddb";
import { createServer } from "vite";
const dom = new Window({ url: "http://localhost:5173/" });
const names = ["window", "document", "navigator", "localStorage", "Event", "CustomEvent", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT", "indexedDB", "Image"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
class TestImage { src = ""; naturalWidth = 400; naturalHeight = 300; async decode() {} }
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "indexedDB" ? indexedDB : name === "Image" ? TestImage : dom[name as keyof Window] });
const originalFetch = globalThis.fetch, createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
globalThis.fetch = async () => { throw new Error("Local profile editing must not upload."); };
URL.createObjectURL = () => "blob:profile-test"; URL.revokeObjectURL = () => {};
const photo = "data:image/png;base64,aGVsbG8=";
const prepared: { width: number; height: number; format: string; quality: number }[] = [];
Object.defineProperty(dom.HTMLCanvasElement.prototype, "getContext", { value: () => ({ drawImage() {}, fillRect() {} }) });
Object.defineProperty(dom.HTMLCanvasElement.prototype, "toDataURL", { value: function (format: string, quality: number) {
  prepared.push({ width: this.width, height: this.height, format, quality });
  return prepared.length === 1 ? `data:image/jpeg;base64,${"A".repeat(300000)}` : photo;
} });
const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-profile-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createRoot } = await import("react-dom/client");
document.body.innerHTML = '<div id="root"></div>'; const root = createRoot(document.getElementById("root")!);
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
try {
  const { AuthContext } = await server.ssrLoadModule("/src/auth/authContext.ts");
  const { ProfileEditor } = await server.ssrLoadModule("/src/components/dashboard/ProfileEditor.tsx");
  const { readLocalWorkspace } = await server.ssrLoadModule("/src/lib/localWorkspace.ts");
  const guest = { token: "fixture", account: { id: "111111111111111111111111", type: "guest" } };
  const render = async (session: typeof guest) => {
    localStorage.setItem("alfred_session", JSON.stringify(session));
    await act(async () => root.render(createElement(AuthContext.Provider, { value: { session } }, createElement(ProfileEditor)))); await settle();
  };
  await render(guest); assert.equal(document.querySelector<HTMLInputElement>("#profile-name")!.value, "Guest");
  const name = document.querySelector<HTMLInputElement>("#profile-name")!;
  await act(async () => { Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(name, "My guest account"); name.dispatchEvent(new dom.Event("input", { bubbles: true })); });
  const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(file, "files", { configurable: true, value: [new dom.File(["png"], "avatar.png", { type: "image/png" })] });
  await act(async () => { file.dispatchEvent(new dom.Event("change", { bubbles: true })); }); await settle();
  assert.equal(document.querySelector<HTMLImageElement>('img[alt="Profile photo preview"]')?.src, photo);
  assert.deepEqual(prepared, [{ width: 512, height: 512, format: "image/jpeg", quality: .92 }, { width: 512, height: 512, format: "image/jpeg", quality: .85 }]);
  await act(async () => { document.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true })); }); await settle();
  assert.equal((await readLocalWorkspace(guest.account.id)).profile.name, "My guest account");
  assert.equal((await readLocalWorkspace(guest.account.id)).profile.picture, photo);
  await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Remove photo")!.click(); });
  await act(async () => { document.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true })); }); await settle();
  assert.equal((await readLocalWorkspace(guest.account.id)).profile.picture, null);
  const google = { token: "fixture", account: { id: "222222222222222222222222", type: "user", name: "Google Name", picture: "https://example.test/photo.png" } };
  await render(google); assert.equal(document.querySelector<HTMLInputElement>("#profile-name")!.value, "Google Name");
  assert.equal(document.querySelector<HTMLImageElement>('img[alt="Profile photo preview"]')?.src, google.account.picture);
  console.log("PASS: Guest/Google defaults, editable names, resized photo upload, removal, local persistence and account isolation.");
} finally {
  await act(async () => root.unmount()); await server.close(); await dom.happyDOM.close(); globalThis.fetch = originalFetch; URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
  for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
