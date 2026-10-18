import assert from "node:assert/strict";
import { test } from "node:test";
import { AppUpdateController, type UpdateProgress } from "../../src/lib/appUpdates.ts";

test("update checks coalesce, distinguish no update from errors, and preserve an available update on failure", async () => {
  let calls = 0;
  let fail = false;
  let available = true;
  const controller = new AppUpdateController({
    async check() { calls++; if (fail) throw new Error("Offline"); return available ? { version: "0.1.0-beta.10" } : null; },
    async install() { throw new Error("Must not install while checking"); },
  });
  await Promise.all([controller.check(), controller.check()]);
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().status, "available");
  fail = true; await controller.check();
  assert.equal(controller.getSnapshot().update?.version, "0.1.0-beta.10");
  assert.equal(controller.getSnapshot().error, "Offline");
  fail = false; available = false; await controller.check();
  assert.equal(controller.getSnapshot().status, "current");
  assert.equal(controller.getSnapshot().update, null);
  assert.equal(controller.getSnapshot().error, "");
});

test("install requires an explicit action, cannot overlap, reports progress, and supports retry after verification failure", async () => {
  let installs = 0;
  let release: (() => void) | undefined;
  let send: ((progress: UpdateProgress) => void) | undefined;
  const controller = new AppUpdateController({
    async check() { return { version: "0.2.0" }; },
    async install(version, progress) {
      assert.equal(version, "0.2.0"); installs++; send = progress;
      if (installs === 1) throw new Error("Signature verification failed");
      await new Promise<void>(resolve => { release = resolve; });
    },
  });
  await controller.install(); assert.equal(installs, 0);
  await controller.check(); assert.equal(installs, 0);
  await controller.install();
  assert.equal(controller.getSnapshot().status, "available");
  assert.match(controller.getSnapshot().error, /verification/);
  const installing = controller.install();
  assert.equal(controller.install(), installing);
  assert.equal(controller.check(), installing);
  await Promise.resolve();
  send!({ event: "downloading", downloaded: 512, total: 1024 });
  assert.equal(controller.getSnapshot().downloaded, 512);
  send!({ event: "installing" });
  assert.equal(controller.getSnapshot().status, "installing");
  release!(); await installing;
  assert.equal(installs, 2);
  assert.equal(controller.getSnapshot().status, "installed");
});
