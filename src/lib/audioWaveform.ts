const waveformCache = new WeakMap<Blob, Promise<number[]>>();
export const WAVEFORM_BARS = 36;

/** Read the finalized PCM16 WAV directly; no decoding context, network or inference. */
export function getAudioWaveform(blob: Blob): Promise<number[]> {
  const cached = waveformCache.get(blob);
  if (cached) return cached;
  const waveform = blob.arrayBuffer().then((buffer) => {
    const view = new DataView(buffer);
    if (view.byteLength <= 44 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645 ||
      view.getUint16(20, true) !== 1 || view.getUint16(34, true) !== 16) throw new Error("Unsupported waveform audio.");
    const channels = view.getUint16(22, true);
    if (channels < 1 || channels > 2 || (view.byteLength - 44) % (channels * 2)) throw new Error("Invalid waveform audio.");
    const frames = (view.byteLength - 44) / (channels * 2);
    const peaks = Array.from({ length: WAVEFORM_BARS }, (_, bar) => {
      const start = Math.floor(bar * frames / WAVEFORM_BARS);
      const end = Math.min(frames, Math.max(start + 1, Math.floor((bar + 1) * frames / WAVEFORM_BARS)));
      let peak = 0;
      for (let frame = start; frame < end; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          peak = Math.max(peak, Math.abs(view.getInt16(44 + (frame * channels + channel) * 2, true)) / 32768);
        }
      }
      return peak;
    });
    const maximum = Math.max(...peaks, .001);
    return peaks.map((peak) => Math.max(.1, Math.sqrt(peak / maximum)));
  });
  waveformCache.set(blob, waveform);
  return waveform;
}
