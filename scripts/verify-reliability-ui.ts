import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-reliability-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { default: AppStateToast, AppStateSelector } = await server.ssrLoadModule("/src/dev/AppStates.tsx");
  const normal = renderToStaticMarkup(createElement(AppStateSelector, { state: "", onChange: () => {} }));
  assert.ok(normal.includes('aria-label="App state"')); assert.match(normal, /value="" selected="">Normal/);
  const states = ["Preview Loading Animation", "Session Expired", "Sync Error", "Body Fetch Error", "Simulate Timeout UI", "Database Error", "Simulate Background Task", "Start Screen"];
  assert.equal((normal.match(/<option\b/g) ?? []).length, states.length + 1);
  for (const state of states) assert.ok(normal.includes(state));
  assert.doesNotMatch(normal, /Offline Mode|Server down|Signed out|Storage full|New account onboarding/);
  for (const state of states) {
    const html = renderToStaticMarkup(createElement(AppStateToast, { state, onChange: () => {} }));
    assert.ok(html.includes('data-simulated="true"'));
    if (state === "Start Screen") { assert.ok(html.includes("Continue as guest")); assert.ok(html.includes("Continue with Google")); continue; }
    assert.ok(html.includes('aria-label="Dismiss notification"'));
    assert.ok(html.includes('role="' + (state === "Preview Loading Animation" || state === "Simulate Background Task" ? "status" : "alert") + '"'));
    assert.doesNotMatch(html, /<dialog|alfred-state|app-state-screen/);
  }
  const source = await readFile("src/dev/AppStates.tsx", "utf8");
  assert.doesNotMatch(source, /\b(apiFetch|apiJson|useAuth|clearSession|localStorage|sessionStorage|fetch)\s*\(/);
  assert.doesNotMatch(source, /AuthContext\.Provider|from\s+["'][^"']*(?:auth\/|hooks\/|lib\/api)/);
  const boundary = await readFile("src/components/reliability/ApplicationBoundary.tsx", "utf8");
  assert.doesNotMatch(boundary, /hidden=\{stateActive\}|className="app-state-screen"/);
  const { Usage } = await server.ssrLoadModule("/src/components/reliability/Usage.tsx");
  const html = renderToStaticMarkup(createElement(Usage, { data: { onboardingCompleted: true, storage: { usedBytes: 1_234_567, limitBytes: 10_000_000, remainingBytes: 8_765_433, overQuota: false }, ai: { daily: { used: 17, limit: 50, remaining: 33, resetAt: "2026-10-18T00:00:00Z" }, monthly: { used: 231, limit: 1000, remaining: 769, resetAt: "2026-11-01T00:00:00Z" } } } }));
  assert.ok(html.includes("17 / 50")); assert.ok(html.includes("231 / 1000")); assert.ok(html.includes("8.765 MB available"));
  const unlimited = renderToStaticMarkup(createElement(Usage, { data: { onboardingCompleted: true, storage: { usedBytes: 20_000_000, limitBytes: null, remainingBytes: null, overQuota: false }, ai: { daily: { used: 2001, limit: null, remaining: null, resetAt: "2026-10-19T00:00:00Z" }, monthly: { used: 2001, limit: null, remaining: null, resetAt: "2026-11-01T00:00:00Z" } } } }));
  assert.ok(unlimited.includes("Cloud storage and AI limits are disabled.")); assert.doesNotMatch(unlimited, /<progress|exhausted|remaining|of 10 MB/);
  console.log("PASS: Normal, seven toast states and Start Screen; no offline mode or auth/persistence overrides.");
} finally { await server.close(); }
