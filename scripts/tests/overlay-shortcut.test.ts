import assert from "node:assert/strict";
import { test } from "node:test";
import { OverlayShortcutController, shortcutFromKey, type OverlayShortcutSnapshot, type ShortcutDriver } from "../../src/lib/overlayShortcut.ts";

const initial: OverlayShortcutSnapshot = { backend: "portal", status: "unconfigured", preferred: "Ctrl+Alt+Space", effective: null, message: null, setupDismissed: false };
const active: OverlayShortcutSnapshot = { ...initial, status: "active", effective: "Ctrl+Alt+K", setupDismissed: true };
function fixture(overrides: Partial<ShortcutDriver> = {}) {
  let changed!: (value: OverlayShortcutSnapshot) => void;
  let watches = 0;
  const controller = new OverlayShortcutController({
    get: async () => initial,
    configure: async () => active,
    dismiss: async () => ({ ...initial, setupDismissed: true }),
    watch: async callback => { watches++; changed = callback; return () => {}; },
    ...overrides,
  });
  return { controller, emit: (value: OverlayShortcutSnapshot) => changed(value), watches: () => watches };
}

test("recorder uses the same modifier grammar as native registration and excludes unsafe keys", () => {
  const key = { key: " ", ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, repeat: false };
  assert.equal(shortcutFromKey(key), "Ctrl+Alt+Space");
  assert.equal(shortcutFromKey({ ...key, key: "k", altKey: false, metaKey: true }), "Ctrl+Super+K");
  assert.equal(shortcutFromKey({ ...key, key: "Control" }), null);
  assert.equal(shortcutFromKey({ ...key, repeat: true }), null);
  assert.throws(() => shortcutFromKey({ ...key, ctrlKey: false, altKey: false }), /Include/);
  assert.throws(() => shortcutFromKey({ ...key, key: ";" }), /Choose/);
});

test("mounts share one listener and a late initial read cannot overwrite a desktop-approved shortcut", async () => {
  let release!: (value: OverlayShortcutSnapshot) => void;
  const value = fixture({ get: () => new Promise(resolve => { release = resolve; }) });
  const started = value.controller.start();
  assert.equal(value.controller.start(), started);
  await Promise.resolve();
  value.emit(active); release(initial); await started;
  assert.equal(value.watches(), 1);
  assert.equal(value.controller.getSnapshot().shortcut?.effective, "Ctrl+Alt+K");
});

test("duplicate clicks cannot open duplicate permission prompts and changed signals win over stale replies", async () => {
  let calls = 0, release!: (value: OverlayShortcutSnapshot) => void;
  const value = fixture({ configure: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  await value.controller.start();
  const pending = value.controller.configure("Ctrl+Alt+K");
  assert.equal(value.controller.configure("Ctrl+Alt+L"), pending);
  await Promise.resolve();
  value.emit(active); release({ ...active, effective: "Old binding" }); await pending;
  assert.equal(calls, 1);
  assert.equal(value.controller.getSnapshot().shortcut?.effective, "Ctrl+Alt+K");
  assert.equal(value.controller.getSnapshot().busy, false);
});

test("denial or a native conflict preserves an active shortcut and allows retry and disable", async () => {
  let denied = true;
  const value = fixture({ get: async () => active, configure: async (_preferred, enabled) => {
    if (denied) throw new Error("Shortcut denied or already in use");
    return enabled ? active : { ...active, status: "disabled", effective: null };
  } });
  await value.controller.start();
  await value.controller.configure("Ctrl+Alt+L");
  assert.equal(value.controller.getSnapshot().shortcut?.effective, active.effective);
  assert.match(value.controller.getSnapshot().error, /denied/);
  denied = false;
  await value.controller.configure("Ctrl+Alt+K");
  assert.equal(value.controller.getSnapshot().error, "");
  await value.controller.configure("Ctrl+Alt+K", false);
  assert.equal(value.controller.getSnapshot().shortcut?.status, "disabled");
  assert.equal(value.controller.getSnapshot().shortcut?.effective, null);
});

test("deferring setup is explicit and does not request shortcut permission", async () => {
  let requests = 0;
  const value = fixture({ configure: async () => { requests++; return active; } });
  await value.controller.start(); await value.controller.dismiss();
  assert.equal(value.controller.getSnapshot().shortcut?.setupDismissed, true);
  assert.equal(requests, 0);
});

test("a failed initial native read cleans up its listener and can be retried", async () => {
  let fail = true, listeners = 0;
  const controller = new OverlayShortcutController({
    get: async () => { if (fail) throw new Error("Native connection unavailable"); return initial; },
    configure: async () => active,
    dismiss: async () => initial,
    watch: async () => { listeners++; return () => { listeners--; }; },
  });
  await controller.start();
  assert.equal(listeners, 0);
  assert.match(controller.getSnapshot().error, /unavailable/);
  fail = false; await controller.start();
  assert.equal(listeners, 1);
  assert.equal(controller.getSnapshot().error, "");
  assert.equal(controller.getSnapshot().shortcut?.status, "unconfigured");
});
