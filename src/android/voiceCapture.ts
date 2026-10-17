import { pcmToWav } from "../lib/audio.ts";
import type { RecordingResult } from "../types/audio.ts";
import { androidAssistantRequest } from "./assistantBridge.ts";

/** Wrap bounded native PCM in a WAV container without changing the captured samples. */
export function decodeNativeSpeech(pcm: unknown, sampleRate: unknown): RecordingResult {
  if (sampleRate !== 16000 || typeof pcm !== "string" || pcm.length > 1280000 || !pcm.length) {
    throw new Error("Android returned invalid voice audio. Please retry.");
  }
  const bytes = atob(pcm);
  if (bytes.length % 2) throw new Error("Android returned incomplete voice audio. Please retry.");
  const pcmBytes = Uint8Array.from(bytes, (c) => c.charCodeAt(0));
  return { audio: pcmToWav(pcmBytes, 16000), durationMs: pcmBytes.length / 32 };
}

export async function recordAssistantSpeech(silenceMs: number): Promise<RecordingResult> {
  window.dispatchEvent(new Event("alfred:pause-playback"));
  const result = await androidAssistantRequest("recordVoice", silenceMs);
  return decodeNativeSpeech(result.pcm, result.sampleRate);
}
