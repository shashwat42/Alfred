import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Windows" } });
const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-update-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { AppUpdateSettings } = await server.ssrLoadModule("/src/components/dashboard/AppUpdateSettings.tsx");
  const { appUpdates } = await server.ssrLoadModule("/src/lib/appUpdates.ts");
  const render = () => renderToStaticMarkup(createElement(AppUpdateSettings));
  assert.equal(render(), "", "Web previews must not offer native updates");
  let update: { version: string; notes: string } | null = { version: "0.1.0-beta.3", notes: "<script>untrusted notes</script>" };
  let fail = false;
  mockIPC(command => {
    assert.equal(command, "check_for_app_update");
    if (fail) throw new Error("Connection unavailable");
    return update;
  });
  assert.match(render(), /Check for updates/);
  assert.doesNotMatch(render(), /Download and install/);
  const check = appUpdates.check();
  assert.match(render(), /disabled=""/);
  await check;
  let html = render();
  assert.match(html, /0\.1\.0-beta\.3 is available/);
  assert.match(html, /Download and install/);
  assert.ok(html.includes("&lt;script&gt;untrusted notes&lt;/script&gt;"));
  assert.doesNotMatch(html, /<script>/);
  fail = true; await appUpdates.check();
  html = render();
  assert.match(html, /role="alert">Connection unavailable/);
  assert.match(html, /Download and install/);
  fail = false; update = null; await appUpdates.check();
  html = render();
  assert.match(html, /up to date/);
  assert.doesNotMatch(html, /Download and install/);
  console.log("PASS: update settings states, disabled checks, retry feedback, escaped release notes and web-preview exclusion.");
} finally {
  clearMocks();
  await server.close();
  if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow); else Reflect.deleteProperty(globalThis, "window");
  if (savedNavigator) Object.defineProperty(globalThis, "navigator", savedNavigator); else Reflect.deleteProperty(globalThis, "navigator");
}
