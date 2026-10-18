import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
// Run after npm run build. This inspects emitted artifacts, including lazy chunks,
// rather than relying on the frontend visibility condition alone.
const assets = path.resolve("dist/assets");
const files = await readdir(assets);
assert.ok(files.some(file => file.endsWith(".js")), "Build production artifacts first");
for (const file of files.filter(file => file.endsWith(".js"))) {
  const code = await readFile(path.join(assets, file), "utf8");
  assert.doesNotMatch(file, /Simulator|AppStates/i);
  for (const marker of ["Simulate Background Task", "Simulate Timeout UI", "Simulated state", "Development only: simulate a state", "developer@example.invalid", "SIMULATED ·", "Developer · UI state simulator", "Simulated deletion only", "Reset preview", "Development state ·", "Development only: choose an app state"]) assert.ok(!code.includes(marker), `${file} contains development marker ${marker}`);
}
console.log("PASS: production artifacts exclude simulator entry, controls and fixtures; client flags have no simulator to activate.");
