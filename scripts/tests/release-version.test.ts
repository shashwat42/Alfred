import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkReleaseVersions, projectRoot } from "../release-config.js";

test("release validation rejects platform and backend drift before packaging", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alfred-release-"));
  const files = ["package.json", "package-lock.json", "Alfred_Backend/package.json", "Alfred_Backend/package-lock.json", "wrapper/tauri.conf.json", "wrapper/tauri.android.conf.json", "wrapper/tauri.linux.conf.json", "wrapper/Cargo.toml", "wrapper/Cargo.lock"];
  try {
    for (const name of files) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.copyFileSync(path.join(projectRoot, name), path.join(root, name));
    }
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    assert.equal(checkReleaseVersions(root), version);
    for (const name of files.filter(name => name !== "package.json")) {
      const file = path.join(root, name), original = fs.readFileSync(file, "utf8");
      const changed = name.endsWith(".json") ? JSON.stringify({ ...JSON.parse(original), version: "0.0.1" }) : original.replace(`version = "${version}"`, 'version = "0.0.1"');
      fs.writeFileSync(file, changed);
      assert.throws(() => checkReleaseVersions(root), /Release versions must match/);
      fs.writeFileSync(file, original);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
