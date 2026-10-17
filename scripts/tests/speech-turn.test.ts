import assert from "node:assert/strict";
import { test } from "node:test";
import { SpeechTurnDetector } from "../../src/lib/speechTurnDetector.ts";
import { AudioRecorder } from "../../src/lib/audioRecorder.ts";
import { sendChatMessage } from "../../src/lib/aiChat.ts";

test("a short greeting ends after the configured pause and completes only once", () => {
  const detector = new SpeechTurnDetector();
  for (let now = 0; now <= 140; now += 20) assert.equal(detector.update(.05, now), false);
  assert.equal(detector.update(0, 1639), false);
  assert.equal(detector.update(0, 1640), true);
  assert.equal(detector.update(0, 1700), false);
});
test("silence, quiet background audio and isolated microphone clicks do not submit", () => {
  const detector = new SpeechTurnDetector();
  for (let now = 0; now <= 4000; now += 20) assert.equal(detector.update(.005, now), false);
  for (let burst = 0; burst < 20; burst++) {
    const now = 5000 + burst * 2000;
    assert.equal(detector.update(.1, now), false);
    assert.equal(detector.update(.1, now + 20), false);
    assert.equal(detector.update(0, now + 1520), false);
  }
});
test("a stalled analyser does not count its missing frames as sustained speech", () => {
  const detector = new SpeechTurnDetector();
  assert.equal(detector.update(.1, 0), false);
  assert.equal(detector.update(.1, 5000), false);
  assert.equal(detector.update(0, 6500), false);
});
test("a longer sentence can continue through pauses shorter than the silence setting", () => {
  const detector = new SpeechTurnDetector();
  for (let now = 0; now <= 1000; now += 20) assert.equal(detector.update(.05, now), false);
  assert.equal(detector.update(0, 2000), false);
  for (let now = 2020; now <= 2220; now += 20) assert.equal(detector.update(.05, now), false);
  assert.equal(detector.update(0, 3719), false);
  assert.equal(detector.update(0, 3720), true);
});
for (const silenceDurationMs of [1000, 2500]) test(`short greetings respect a ${silenceDurationMs}ms pause setting`, () => {
  const detector = new SpeechTurnDetector({ silenceDurationMs });
  for (let now = 0; now <= 140; now += 20) detector.update(.05, now);
  assert.equal(detector.update(0, 140 + silenceDurationMs - 1), false);
  assert.equal(detector.update(0, 140 + silenceDurationMs), true);
});
test("explicit speech-duration overrides still work and rejected noise does not contaminate the next turn", () => {
  const detector = new SpeechTurnDetector({ minSpeechDurationMs: 500 });
  for (let now = 0; now <= 140; now += 20) detector.update(.05, now);
  assert.equal(detector.update(0, 1640), false);
  for (let now = 2000; now <= 2600; now += 20) detector.update(.05, now);
  assert.equal(detector.update(0, 4100), true);
});

test("a short voice turn auto-stops, releases the mic, and reaches the authenticated audio request", async () => {
  const names = ["navigator", "window", "AudioContext", "MediaRecorder", "requestAnimationFrame", "cancelAnimationFrame", "performance", "localStorage", "fetch"];
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  let clock = 0, amplitude = 128, frameId = 0, trackStops = 0, turnEnds = 0, requests = 0;
  const frames = new Map<number, () => void>();
  class Context {
    state = "running";
    async close() { this.state = "closed"; }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, smoothingTimeConstant: 0, getByteTimeDomainData(data: Uint8Array) { data.fill(amplitude); } }; }
    async decodeAudioData() { return { duration: 1.66, numberOfChannels: 1, sampleRate: 16000, length: 26560, getChannelData: () => new Float32Array(26560).fill(.2) }; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    mimeType = "audio/webm"; state = "inactive";
    ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["encoded capture"]) }); queueMicrotask(() => this.onstop?.()); }
  }
  const session = { token: "voice-test-token", account: { id: "111111111111111111111111", type: "user" } };
  const fixtures = [
    { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { trackStops++; } }] }) } },
    { AudioContext: Context, dispatchEvent() {}, location: { search: "", pathname: "/", hash: "" } }, Context, Recorder,
    (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
    (id: number) => { frames.delete(id); }, { now: () => clock },
    { getItem: (key: string) => key === "alfred_session" ? JSON.stringify(session) : null },
    async (url: string, init: RequestInit) => {
      requests++; assert.ok(url.endsWith("/api/ai/chat/audio"));
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer voice-test-token");
      assert.ok(init.body instanceof FormData);
      const audio = init.body.get("audio"); assert.ok(audio instanceof Blob); assert.equal(audio.type, "audio/wav");
      return Response.json({ message: { role: "assistant", content: "Hi!" }, model: "test", finishReason: "stop" });
    },
  ];
  const recorder = new AudioRecorder();
  try {
    names.forEach((name, i) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: fixtures[i] }));
    const started = new Promise<void>(resolve => recorder.addStateListener(state => { if (state === "recording") resolve(); }));
    const turn = recorder.recordTurn({ onTurnDetected: () => { turnEnds++; } });
    await started;
    const sample = (now: number, speech: boolean) => {
      clock = now; amplitude = speech ? 140 : 128;
      const entry = frames.entries().next().value; assert.ok(entry);
      frames.delete(entry[0]); entry[1]();
    };
    sample(0, false);
    for (let now = 20; now <= 160; now += 20) sample(now, true);
    sample(1659, false); assert.equal(recorder.getState(), "recording");
    sample(1660, false);
    const recording = await turn;
    assert.equal(turnEnds, 1); assert.equal(trackStops, 1); assert.equal(frames.size, 0);
    assert.equal(recording.durationMs, 1660); assert.equal(recorder.getState(), "inactive");
    const result = await sendChatMessage([{ role: "user", content: "Voice message" }], undefined, { recording });
    assert.equal(result.message.content, "Hi!"); assert.equal(requests, 1);
  } finally {
    recorder.cancel();
    names.forEach((name, i) => { if (saved[i]) Object.defineProperty(globalThis, name, saved[i]!); else Reflect.deleteProperty(globalThis, name); });
  }
});
