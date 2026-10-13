import { pipeline, env } from "@huggingface/transformers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

env.allowLocalModels = false;
env.useBrowserCache = false;

function decodeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const sampleRate = view.getUint32(24, true);
  const numChannels = view.getUint16(22, true);

  let pos = 36;
  while (pos < buffer.length - 8) {
    const chunkId = String.fromCharCode(...buffer.subarray(pos, pos + 4));
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === "data") {
      pos += 8;
      break;
    }
    pos += 8 + chunkSize;
  }

  const rawBytes = buffer.subarray(pos);
  const numSamples = Math.floor(rawBytes.length / (2 * numChannels));
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const sampleOffset = (i * numChannels + ch) * 2;
      sum += view.getInt16(pos + sampleOffset, true);
    }
    samples[i] = (sum / numChannels) / 32768.0;
  }

  if (sampleRate !== 16000) {
    const ratio = sampleRate / 16000;
    const newLen = Math.round(samples.length / ratio);
    const resampled = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const srcIdx = i * ratio;
      const idxFloor = Math.floor(srcIdx);
      const frac = srcIdx - idxFloor;
      const s0 = samples[idxFloor] || 0;
      const s1 = samples[idxFloor + 1] || s0;
      resampled[i] = s0 + frac * (s1 - s0);
    }
    return { audio: resampled, sampleRate: 16000 };
  }

  return { audio: samples, sampleRate };
}

async function benchmark(modelId) {
  console.log(`\n========================================`);
  console.log(`Benchmarking: ${modelId}`);
  console.log(`========================================`);

  const initStart = performance.now();
  const transcriber = await pipeline("automatic-speech-recognition", modelId, {
    dtype: "q8",
  });
  const initDuration = performance.now() - initStart;
  console.log(`Init / load time: ${initDuration.toFixed(1)}ms`);

  const wavPath = path.resolve(__dirname, "../public/test-audio/jfk.wav");
  const wavBuffer = fs.readFileSync(wavPath);
  const { audio } = decodeWav(wavBuffer);

  // Cold
  const coldStart = performance.now();
  const coldRes = await transcriber(audio, { chunk_length_s: 30 });
  const coldDuration = performance.now() - coldStart;
  console.log(`Cold inference: ${coldDuration.toFixed(1)}ms`);
  console.log(`Cold text: "${coldRes.text}"`);

  // Warm
  const warmStart = performance.now();
  const warmRes = await transcriber(audio, { chunk_length_s: 30 });
  const warmDuration = performance.now() - warmStart;
  console.log(`Warm inference: ${warmDuration.toFixed(1)}ms`);
  console.log(`Warm text: "${warmRes.text}"`);

  return {
    modelId,
    initDuration,
    coldDuration,
    warmDuration,
    text: warmRes.text,
  };
}

async function run() {
  const multi = await benchmark("onnx-community/whisper-tiny");
  const english = await benchmark("onnx-community/whisper-tiny.en");

  console.log("\n--- Comparison Summary ---");
  console.log(JSON.stringify({ multi, english }, null, 2));
}

run().catch(console.error);
