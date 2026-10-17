import assert from "node:assert/strict";
import { test } from "node:test";
import { pcmToWav, MAX_AUDIO_BYTES } from "../../src/lib/audio.ts";
import { attachVoiceNote, toggleVoiceNote } from "../../src/lib/audioPlayback.ts";
import { boundVoiceResources } from "../../src/lib/aiChat.ts";
import { AudioRecorder } from "../../src/lib/audioRecorder.ts";
import { getAudioWaveform, WAVEFORM_BARS } from "../../src/lib/audioWaveform.ts";

test("waveform reflects recorded PCM amplitudes and reuses its cached result", async () => {
  const pcm = new Uint8Array(WAVEFORM_BARS * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < WAVEFORM_BARS; i++) view.setInt16(i * 2, i < WAVEFORM_BARS / 2 ? 256 : 16384, true);
  const blob = pcmToWav(pcm, 16000);
  const pending = getAudioWaveform(blob);
  assert.equal(getAudioWaveform(blob), pending);
  const bars = await pending;
  assert.equal(bars.length, WAVEFORM_BARS);
  assert.equal(bars[0], .125);
  assert.equal(bars.at(-1), 1);
  await assert.rejects(getAudioWaveform(new Blob(["not a WAV"])), /Unsupported/);
});

test("WAV retains original PCM bytes and rejects empty, partial and oversized buffers", async () => {
  const pcm = new Uint8Array([0, 128, 255, 127]);
  const blob = pcmToWav(pcm, 16000);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()).slice(44), pcm);
  assert.throws(() => pcmToWav(new Uint8Array(), 16000));
  assert.throws(() => pcmToWav(new Uint8Array(3), 16000));
  assert.throws(() => pcmToWav(new Uint8Array(MAX_AUDIO_BYTES), 16000));
});

test("playback uses the uploaded Blob after upload, pauses/resumes locally, cleans URL on removal", async () => {
  const blob = pcmToWav(new Uint8Array([0, 128]), 16000);
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalFetch = globalThis.fetch;
  let revoked = 0, plays = 0, pauses = 0, loads = 0;
  URL.createObjectURL = (value) => { assert.equal(value, blob); return "blob:original"; };
  URL.revokeObjectURL = (url) => { assert.equal(url, "blob:original"); revoked++; };
  globalThis.fetch = async () => { throw new Error("Playback must not make a request"); };
  const doc = new EventTarget(), win = new EventTarget();
  const element = { src: "", paused: true, async play() { this.paused = false; plays++; }, pause() { this.paused = true; pauses++; }, removeAttribute() { this.src = ""; }, load() { loads++; } };
  try {
    const dispose = attachVoiceNote(element as unknown as HTMLAudioElement, blob, doc as Document, win as Window & typeof globalThis);
    assert.equal(element.src, "blob:original");
    await toggleVoiceNote(element as unknown as HTMLAudioElement);
    await toggleVoiceNote(element as unknown as HTMLAudioElement);
    await toggleVoiceNote(element as unknown as HTMLAudioElement);
    assert.equal(plays, 2); assert.equal(pauses, 1); assert.equal(revoked, 0);
    win.dispatchEvent(new Event("alfred:pause-playback")); assert.equal(element.paused, true);
    dispose(); assert.equal(revoked, 1); assert.equal(loads, 1); assert.equal(element.src, "");
    const prior = pauses; win.dispatchEvent(new Event("pagehide")); assert.equal(pauses, prior);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; globalThis.fetch = originalFetch; }
});

test("retained recording memory is bounded while preserving message order and recent exact Blobs", () => {
  const recording = { audio: new Blob([new Uint8Array(12 * 1024 * 1024)]), durationMs: 60000 };
  const messages = Array.from({ length: 6 }, (_, i) => ({ id: String(i), role: "user" as const, timestamp: i, content: "Voice message", recording }));
  const bounded = boundVoiceResources(messages);
  assert.deepEqual(bounded.map((m) => m.id), messages.map((m) => m.id));
  assert.equal(bounded.filter((m) => m.recording).length, 4);
  assert.equal(bounded[5].recording?.audio, recording.audio);
  assert.equal(bounded[0].content, "Recording no longer available");
});

test("recording finalizes once at watchdog/stop, releases microphone, rejects duplicates and cancellation", async () => {
  const names = ["navigator", "window", "AudioContext", "MediaRecorder", "requestAnimationFrame", "cancelAnimationFrame", "performance"];
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  let stopped = 0, clock = 0;
  class Context {
    state = "running";
    async close() { this.state = "closed"; }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0 }; }
    async decodeAudioData() { return { duration: .5, numberOfChannels: 1, sampleRate: 16000, length: 8000, getChannelData: () => new Float32Array(8000).fill(.2) }; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    mimeType = "audio/webm"; state = "inactive";
    ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["encoded capture"]) }); queueMicrotask(() => this.onstop?.()); }
  }
  const fixtures = [
    { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) } },
    { AudioContext: Context, dispatchEvent() {} }, Context, Recorder, () => 1, () => {}, { now: () => { clock += 500; return clock; } },
  ];
  const recorder = new AudioRecorder();
  try {
    names.forEach((name, i) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: fixtures[i] }));
    const states: string[] = []; recorder.addStateListener((state) => states.push(state));
    const turn = recorder.record({ maxDurationMs: 10 });
    await assert.rejects(recorder.record(), /already/);
    const result = await turn;
    assert.equal(result.audio.type, "audio/wav"); assert.equal(stopped, 1);
    assert.deepEqual(states, ["inactive", "recording", "processing", "inactive"]);
    await assert.rejects(recorder.stop(), /No active/);
    const cancelled = recorder.record();
    const rejection = assert.rejects(cancelled, /cancel/i); recorder.cancel(); await rejection;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(stopped, 2); assert.equal(recorder.getState(), "inactive");
  } finally {
    recorder.cancel();
    names.forEach((name, i) => { if (saved[i]) Object.defineProperty(globalThis, name, saved[i]!); else Reflect.deleteProperty(globalThis, name); });
  }
});
