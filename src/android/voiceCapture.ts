import { androidAssistantRequest } from "./assistantBridge.ts";

/** Converts bounded native 16-bit little-endian speech PCM for the existing Whisper worker. */
export function decodeNativeSpeech(pcm: unknown, sampleRate: unknown): Float32Array {
  if (sampleRate !== 16000 || typeof pcm !== "string" || pcm.length > 1280000 || !pcm.length) {
    throw new Error("Android returned invalid voice audio. Please retry.");
  }
  const bytes = atob(pcm);
  if (bytes.length % 2) throw new Error("Android returned incomplete voice audio. Please retry.");
  const samples = new Float32Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index++) {
    const value = bytes.charCodeAt(index * 2) | bytes.charCodeAt(index * 2 + 1) << 8;
    samples[index] = (value >= 32768 ? value - 65536 : value) / 32768;
  }
  return samples;
}

export async function recordAssistantSpeech(silenceMs: number): Promise<Float32Array> {
  const result = await androidAssistantRequest("recordVoice", silenceMs);
  return decodeNativeSpeech(result.pcm, result.sampleRate);
}
