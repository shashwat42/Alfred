import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopPlatform } from "../../src/lib/desktopPlatform.ts";
import { AudioRecorder } from "../../src/lib/audioRecorder.ts";
import { supportsAppUpdates } from "../../src/lib/appUpdates.ts";

test("Linux desktop native features exclude Android and browser updates", () => {
  assert.equal(desktopPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15"), "linux");
  assert.equal(desktopPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");
  assert.equal(desktopPlatform("Mozilla/5.0 (Linux; Android 16)"), null);
  assert.equal(desktopPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)"), null);
});

test("Fedora capture requires consent before requesting the microphone; denial can be retried", async () => {
  const names = ["window", "navigator"] as const;
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  let prompts = 0, captures = 0;
  const windowMock = Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {
    async invoke(command: string) { assert.equal(command, "request_microphone_consent"); prompts++; return false; },
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowMock });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    mediaDevices: { async getUserMedia() { captures++; throw new Error("Must not capture without consent"); } },
  } });
  try {
    assert.equal(supportsAppUpdates(), true, "RPM installs use the Linux updater commands");
    const recorder = new AudioRecorder();
    await assert.rejects(recorder.start(), /permission was denied/i);
    await assert.rejects(recorder.start(), /permission was denied/i);
    assert.equal(prompts, 2);
    assert.equal(captures, 0);
  } finally {
    names.forEach((name, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
