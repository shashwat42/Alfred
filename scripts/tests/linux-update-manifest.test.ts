import assert from "node:assert/strict";
import { test } from "node:test";
import { createLinuxUpdateManifest } from "../linux-update-manifest.js";

const fixture = { version: "1.0.3", architecture: "x86_64", rpm: "Alfred-1.0.3-1.x86_64.rpm", signature: "signed-fixture\n", sha256: "a".repeat(64), size: 100, notes: "Linux update" };
test("Linux updater manifests bind the release URL, architecture, signature, size and checksum", () => {
  const value = createLinuxUpdateManifest(fixture);
  assert.deepEqual(value.platforms["linux-x86_64"], { url: "https://github.com/shashwat42/Alfred/releases/download/v1.0.3/Alfred-1.0.3-1.x86_64.rpm", signature: "signed-fixture", size: 100, sha256: "a".repeat(64) });
  for (const patch of [{ signature: "" }, { architecture: "armv7" }, { rpm: "other.rpm" }, { size: 0 }, { size: 129 * 1024 * 1024 }, { sha256: "invalid" }, { version: "1.0.03" }]) {
    assert.throws(() => createLinuxUpdateManifest({ ...fixture, ...patch }));
  }
  const arm = createLinuxUpdateManifest({ ...fixture, architecture: "aarch64", rpm: "Alfred-1.0.3-1.aarch64.rpm" });
  assert.ok(arm.platforms["linux-aarch64"]);
});
