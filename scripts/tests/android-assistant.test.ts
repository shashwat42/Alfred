import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFetch } from "../../src/lib/api.ts";
import { AUTH_STORAGE_KEY, getSession } from "../../src/auth/auth.ts";
import { buildSafeChatContext, sendChatMessage } from "../../src/lib/aiChat.ts";
import { decodeNativeSpeech } from "../../src/android/voiceCapture.ts";
import { androidAssistantRequest, ASSISTANT_VOICE_LEVEL_EVENT } from "../../src/android/assistantBridge.ts";
import { audioRecorder } from "../../src/lib/audioRecorder.ts";
import { resolveWindowSurface } from "../../src/lib/windowSurface.ts";
import { readAndroidRuntimeConfig } from "../android-runtime-config.js";
import { assistantBindingHealth } from "../android-assistant-health.js";
import { fileURLToPath } from "node:url";

test("Android packages only its main app window and preserves desktop windows", async () => {
  const wrapper = fileURLToPath(new URL("../../wrapper/", import.meta.url));
  const config = readAndroidRuntimeConfig(wrapper);
  assert.deepEqual(config.app.windows, [{ label: "main", title: "Alfred", url: "index.html" }]);
  assert.equal(config.build.devUrl, null);
  assert.equal(config.version, "0.1.0-beta.5.1");
  assert.equal(config.bundle.android.versionCode, 1007);
  const { readFile } = await import("node:fs/promises");
  const desktop = JSON.parse(await readFile(new URL("../../wrapper/tauri.conf.json", import.meta.url), "utf8"));
  assert.ok(desktop.app.windows.some((window: { label: string }) => window.label === "overlay"));
});

test("persistent Android assistant binding is isolated from the Tauri UI process", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = await readFile(new URL("../../wrapper/android/assistant/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const voice = manifest.match(/<service\b[^>]*android:name="com\.alfred\.assistant\.AlfredVoiceService"[^>]*>/)?.[0];
  const session = manifest.match(/<service\b[^>]*android:name="com\.alfred\.assistant\.AlfredSessionService"[^>]*>/)?.[0];
  assert.match(voice ?? "", /android:process=":assistant"/);
  assert.ok(session);
  assert.doesNotMatch(session, /android:process=/);
});

test("Android never renders the Windows overlay in its normal app WebView", () => {
  assert.equal(resolveWindowSurface("?window=overlay", "", true), "app");
  assert.equal(resolveWindowSurface("", "#window=overlay", true), "app");
  assert.equal(resolveWindowSurface("?window=android-assistant", "", true), "android-assistant");
  assert.equal(resolveWindowSurface("?window=overlay", "", false), "desktop-overlay");
  assert.equal(resolveWindowSurface("", "#window=overlay", false), "desktop-overlay");
});

test("a visible session cannot mask a dead assistant-service binding; audio UID policy is reported separately", () => {
  const selected = "mComponent=com.alfred.app/com.alfred.assistant.AlfredVoiceService\nuid=10382\n";
  const audio = "UID Policy:\nAssistants UIDs:\n UID[0]=10382\nActive Assistants UIDs:\nAccessibility UIDs:";
  const dead = selected + "mBound=true mService=null\nActive session:\nmShown=true\nmBound=true\nmService=live-session-binder";
  assert.equal(assistantBindingHealth(dead, audio).ready, false);
  const live = selected + "mBound=true mService=live-service-binder";
  assert.equal(assistantBindingHealth(live, audio).ready, true);
  assert.equal(assistantBindingHealth(live, audio.replace("10382", "10241")).audioRecognizesAssistant, false);
});

test("closing voice while permission is pending stops the late microphone stream", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let deliver: (stream: MediaStream) => void = () => {};
  let stopped = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { deliver = resolve; }) } } });
  try {
    const pending = audioRecorder.start();
    const rejected = assert.rejects(pending, /Recording cancelled/);
    audioRecorder.cancel();
    deliver({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream);
    await rejected;
    assert.equal(stopped, 1);
    assert.equal(audioRecorder.getState(), "inactive");
  } finally {
    audioRecorder.cancel();
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("voice recording resumes a suspended audio context before starting silence detection", async () => {
  const saved = Object.fromEntries(["navigator", "window", "MediaRecorder", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let resumed = 0;
  let stopped = 0;
  class TestContext {
    state = "suspended";
    async resume() { resumed++; this.state = "running"; }
    async close() { this.state = "closed"; }
    createMediaStreamSource() { assert.equal(this.state, "running"); return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0 }; }
  }
  class TestRecorder {
    static isTypeSupported() { return true; }
    state = "inactive";
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; }
  }
  const fixtures = {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) } },
    window: { AudioContext: TestContext, dispatchEvent: () => true }, MediaRecorder: TestRecorder,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  };
  try {
    for (const [key, value] of Object.entries(fixtures)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    await audioRecorder.start({ enableSilenceDetection: true });
    assert.equal(resumed, 1);
    assert.equal(audioRecorder.getState(), "recording");
    audioRecorder.cancel();
    assert.equal(stopped, 1);
    assert.equal(audioRecorder.getState(), "inactive");
  } finally {
    audioRecorder.cancel();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

// Isolated in-memory storage and network fixtures; never touches an app profile or server.
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, location: { search: "" }, dispatchEvent: () => true } });

test("assistant requests keep expired account sessions instead of provisioning a guest", async () => {
  const originalFetch = globalThis.fetch;
  values.set(AUTH_STORAGE_KEY, JSON.stringify({ token: "unit-test-token", account: { id: "account-a", type: "user" } }));
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer unit-test-token");
    return new Response("{}", { status: 401 });
  };
  try {
    const response = await apiFetch("/api/ai/chat", { _preserveAccount: true, _expectedAccountId: "account-a" });
    assert.equal(response.status, 401);
    assert.equal(calls, 1);
    assert.equal(getSession()?.account.id, "account-a");
    await assert.rejects(apiFetch("/api/ai/chat", { _preserveAccount: true, _expectedAccountId: "account-b" }), /account changed/i);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; values.clear(); }
});

test("shared chat validation excludes failed turns and bounds assistant context", () => {
  const history = Array.from({ length: 40 }, (_, index) => ({ id: String(index), timestamp: index, role: "assistant" as const, content: "x".repeat(4000) }));
  const context = buildSafeChatContext([...history, { id: "failed", timestamp: 42, role: "user", content: "not sent", error: "offline" }], "latest");
  assert.ok(context.length <= 20);
  assert.ok(context.reduce((total, item) => total + item.content.length, 0) <= 20000);
  assert.deepEqual(context.at(-1), { role: "user", content: "latest" });
  assert.ok(!context.some((item) => item.content === "not sent"));
});

test("native assistant PCM wraps exact signed mono samples in playable WAV", async () => {
  const result = decodeNativeSpeech(btoa(String.fromCharCode(0, 128, 0, 0, 255, 127)), 16000);
  assert.equal(result.audio.type, "audio/wav");
  assert.deepEqual([...new Uint8Array(await result.audio.arrayBuffer()).slice(44)], [0, 128, 0, 0, 255, 127]);
  assert.throws(() => decodeNativeSpeech("AA==", 16000), /incomplete/);
  assert.throws(() => decodeNativeSpeech("AAAA", 48000), /invalid/);
  assert.throws(() => decodeNativeSpeech("A".repeat(1280001), 16000), /invalid/);
});

test("live voice levels update the logo without completing or replacing the capture request", async () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  let requestId = "";
  const levels: number[] = [];
  const bridge = { onmessage: null as null | ((event: { data: string }) => void), postMessage(raw: string) { requestId = JSON.parse(raw).id; } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    AlfredAndroid: bridge, setTimeout, dispatchEvent(event: CustomEvent<number>) { assert.equal(event.type, ASSISTANT_VOICE_LEVEL_EVENT); levels.push(event.detail); },
  } });
  try {
    let completed = false;
    const recording = androidAssistantRequest("recordVoice", 1500).then((value) => { completed = true; return value; });
    bridge.onmessage!({ data: JSON.stringify({ id: requestId, event: "voiceLevel", level: .7 }) });
    bridge.onmessage!({ data: JSON.stringify({ id: requestId, event: "voiceLevel", level: 4 }) });
    await Promise.resolve();
    assert.equal(completed, false);
    assert.deepEqual(levels, [.7, 1]);
    bridge.onmessage!({ data: JSON.stringify({ id: requestId, pcm: "AAAA", sampleRate: 16000 }) });
    assert.equal((await recording).sampleRate, 16000);
    assert.equal(completed, true);
  } finally { Object.defineProperty(globalThis, "window", savedWindow); }
});

test("an empty successful AI response becomes a retryable failure", async () => {
  const originalFetch = globalThis.fetch;
  values.set(AUTH_STORAGE_KEY, JSON.stringify({ token: "unit-test-token", account: { id: "account-a", type: "user" } }));
  globalThis.fetch = async () => Response.json({ message: { role: "assistant", content: "  " } });
  try { await assert.rejects(sendChatMessage([{ role: "user", content: "hello" }]), /empty response/i); }
  finally { globalThis.fetch = originalFetch; values.clear(); }
});

test("expired app sessions never downgrade to a new guest", async () => {
  const originalFetch = globalThis.fetch;
  values.set(AUTH_STORAGE_KEY, JSON.stringify({ token: "expired-test-token", account: { id: "old-account", type: "guest" } }));
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    if (String(url).endsWith("/auth/guest")) return Response.json({ token: "fresh-test-token", account: { id: "new-account", type: "guest" } });
    return new Response("{}", { status: 401 });
  };
  try {
    assert.equal((await apiFetch("/api/tasks")).status, 401);
    assert.equal(calls, 2);
    assert.equal(getSession()?.account.id, "old-account");
  } finally { globalThis.fetch = originalFetch; values.clear(); }
});

test("voice upload uses the exact Blob and retains earlier audio for follow-up text with one request", async () => {
  const saved = globalThis.fetch;
  values.set(AUTH_STORAGE_KEY, JSON.stringify({ token: "unit-test-token", account: { id: "account-a", type: "user" } }));
  const recording = decodeNativeSpeech(btoa(String.fromCharCode(0, 128, 0, 0, 255, 127)), 16000);
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.ok(String(url).endsWith("/api/ai/chat/audio"));
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get(calls === 1 ? "audio" : "audio-0");
    assert.ok(file instanceof Blob);
    assert.deepEqual(await file.arrayBuffer(), await recording.audio.arrayBuffer());
    assert.equal(new Headers(init.headers).get("Content-Type"), null);
    const context = JSON.parse(String(init.body.get("context")));
    assert.ok(context.messages.every((message: object) => !("recording" in message)));
    return Response.json({ message: { role: "assistant", content: "answer" } });
  };
  try {
    await sendChatMessage([{ role: "user", content: "Voice message" }], undefined, { recording });
    const context = buildSafeChatContext([{ id: "voice", role: "user", content: "Voice message", timestamp: 0, recording }, { id: "reply", role: "assistant", content: "answer", timestamp: 1 }], "What did I say?");
    await sendChatMessage(context);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = saved; values.clear(); }
});
