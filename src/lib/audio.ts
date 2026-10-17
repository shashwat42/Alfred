import { AudioRecorderError, type RecordingResult } from "../types/audio.ts";

export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

/** Wrap native PCM without altering samples; the same WAV Blob is uploaded and played. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Blob {
  if (!pcm.length || pcm.length % (2 * channels) || pcm.length + 44 > MAX_AUDIO_BYTES) throw new Error("Invalid or oversized recording.");
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, pcm.length + 36, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, pcm.length, true);
  return new Blob([header, new Uint8Array(pcm)], { type: "audio/wav" });
}

/** Compatibility endpoint documents WAV. Decode only to encode PCM16, retaining rate/channels. */
export async function prepareRecording(blob: Blob, durationMs: number): Promise<RecordingResult> {
  if (!blob.size || blob.size > MAX_AUDIO_BYTES) throw new Error("Empty or oversized recording.");
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = decoded.numberOfChannels;
    if (decoded.duration > 60.5 || decoded.length * channels * 2 + 44 > MAX_AUDIO_BYTES) throw new Error("Recording exceeds the audio limit.");
    const pcm = new Uint8Array(decoded.length * channels * 2);
    const view = new DataView(pcm.buffer);
    let signal = false;
    for (let channel = 0; channel < channels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]!));
        if (Math.abs(sample) > .003) signal = true;
        view.setInt16((i * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      }
    }
    if (!signal) throw new AudioRecorderError("EMPTY_AUDIO", "Recording contains no audible speech.");
    return { audio: pcmToWav(pcm, decoded.sampleRate, channels), durationMs };
  } finally { await ctx.close(); }
}
