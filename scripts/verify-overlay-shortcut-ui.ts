import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { Window } from "happy-dom";
import { createServer } from "vite";
import type { OverlayShortcutSnapshot } from "../src/lib/overlayShortcut.ts";

const dom = new Window({ url: "http://localhost:5173/" });
const names = ["window", "document", "navigator", "localStorage", "Event", "CustomEvent", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom[name as keyof Window] });
Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (X11; Linux x86_64)" });
let shortcut: OverlayShortcutSnapshot = { backend: "portal", status: "unconfigured", preferred: "Ctrl+Alt+Space", effective: null, message: null, setupDismissed: false };
let reject = true, requests = 0, settings = 0, watchers = 0;
const callbacks = new Map<number, (event: unknown) => void>();
let handler = 0;
Object.assign(window, { __TAURI_INTERNALS__: {
  transformCallback(callback: (event: unknown) => void) { const id = callbacks.size + 1; callbacks.set(id, callback); return id; },
  async invoke(command: string, args: { handler?: number; preferred?: string; enabled?: boolean } = {}) {
    if (command === "plugin:event|listen") { watchers++; handler = args.handler!; return 1; }
    if (command === "get_overlay_shortcut") return shortcut;
    if (command === "configure_overlay_shortcut") {
      requests++;
      if (reject) throw new Error("Shortcut approval cancelled");
      shortcut = { ...shortcut, preferred: args.preferred!, status: args.enabled ? "active" : "disabled", effective: args.enabled ? "Ctrl+Alt+K" : null, setupDismissed: true };
      callbacks.get(handler)?.({ payload: shortcut });
      return shortcut;
    }
    if (command === "open_overlay_keyboard_settings") { settings++; return; }
    if (command === "dismiss_overlay_shortcut_setup") { shortcut = { ...shortcut, setupDismissed: true }; return shortcut; }
    throw new Error(`Unexpected native command: ${command}`);
  },
} });

const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-shortcut-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createRoot } = await import("react-dom/client");
document.body.innerHTML = '<div id="root"></div>';
const root = createRoot(document.getElementById("root")!);
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
try {
  const { OverlayShortcutSettings, OverlayShortcutRuntime } = await server.ssrLoadModule("/src/components/dashboard/OverlayShortcutSettings.tsx");
  await act(async () => root.render(createElement(Fragment, null, createElement(OverlayShortcutRuntime), createElement(OverlayShortcutSettings))));
  await settle();
  const dialog = () => document.querySelector("dialog")!;
  const section = () => document.querySelector("section")!;
  const button = (parent: Element, text: string) => Array.from(parent.querySelectorAll("button")).find(value => value.textContent?.includes(text))!;
  assert.equal(dialog().open, true, "Fedora first run offers setup");
  assert.equal(requests, 0, "A prompt is requested only after the user chooses Enable");
  await act(async () => button(dialog(), "Enable global shortcut").click()); await settle();
  assert.equal(dialog().open, true);
  assert.match(dialog().textContent!, /approval cancelled/);
  reject = false;
  await act(async () => button(dialog(), "Enable global shortcut").click()); await settle();
  assert.equal(dialog().open, false);
  assert.match(section().textContent!, /Active shortcut: Ctrl\+Alt\+K/);
  assert.ok(button(section(), "Change in desktop"));
  const recorder = section().querySelector<HTMLButtonElement>('[aria-label="Record overlay keybind"]')!;
  await act(async () => recorder.click());
  await act(async () => recorder.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "l", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })));
  assert.match(recorder.textContent!, /Ctrl\+Alt\+L/);
  await act(async () => button(section(), "Change in desktop").click()); await settle();
  assert.equal(shortcut.preferred, "Ctrl+Alt+L");
  assert.match(section().textContent!, /Active shortcut: Ctrl\+Alt\+K/, "The desktop-approved binding is authoritative");
  await act(async () => button(section(), "Open Keyboard settings").click()); await settle();
  assert.equal(settings, 1);
  await act(async () => button(section(), "Disable").click()); await settle();
  assert.equal(shortcut.status, "disabled");
  assert.equal(dialog().open, false, "Disabling does not reopen first-run setup");
  assert.equal(watchers, 1);
  console.log("PASS: Fedora setup, explicit system approval, cancellation/retry, key recording, authoritative desktop changes, fallback and disable.");
} finally {
  await act(async () => root.unmount()); await server.close(); await dom.happyDOM.close();
  for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
