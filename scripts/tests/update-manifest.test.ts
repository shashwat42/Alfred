import assert from "node:assert/strict";
import { test } from "node:test";
import { createUpdateManifest } from "../update-manifest.js";

test("published updater manifest identifies the exact signed Windows installer", () => {
  const input = { version: "0.1.0-beta.2", installer: "Alfred_0.1.0-beta.2_windows_x64-setup.exe", signature: "signed-fixture\n", notes: "Release notes", publishedAt: "2026-10-18T00:00:00Z" };
  const manifest = createUpdateManifest(input);
  assert.equal(manifest.version, input.version);
  assert.equal(manifest.pub_date, input.publishedAt);
  assert.deepEqual(manifest.platforms["windows-x86_64"], {
    signature: "signed-fixture",
    url: "https://github.com/shashwat42/Alfred/releases/download/v0.1.0-beta.2/Alfred_0.1.0-beta.2_windows_x64-setup.exe",
  });
  assert.throws(() => createUpdateManifest({ ...input, signature: "" }), /signed update/);
  assert.throws(() => createUpdateManifest({ ...input, installer: "older-setup.exe" }), /match/);
  const patch = createUpdateManifest({ ...input, version: "0.1.0-beta.5.1", installer: "Alfred_0.1.0-beta.5.1_windows_x64-setup.exe" });
  assert.equal(patch.version, "0.1.0-beta.5.1");
  const stable = createUpdateManifest({ ...input, version: "1.0.0", installer: "Alfred_1.0.0_windows_x64-setup.exe" });
  assert.equal(stable.version, "1.0.0");
  assert.equal(stable.platforms["windows-x86_64"].url, "https://github.com/shashwat42/Alfred/releases/download/v1.0.0/Alfred_1.0.0_windows_x64-setup.exe");
  for (const version of ["1.0", "1.0.0-rc.1", "v1.0.0", "1.0.0-beta."]) {
    assert.throws(() => createUpdateManifest({ ...input, version }), /stable or numbered beta/);
  }
});
