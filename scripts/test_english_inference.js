import fs from "node:fs";
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

function parseWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const sampleRate = view.getUint32(24, true);
  const numChannels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);

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
    return resampled;
  }

  return samples;
}

async function main() {
  console.log("=== Testing English-Only Whisper (onnx-community/whisper-tiny.en) ===");
  const modelId = "onnx-community/whisper-tiny.en";
  console.log(`Target Model: ${modelId}`);

  const startMem = process.memoryUsage().heapUsed;
  const loadStart = performance.now();

  console.log("1. Initializing pipeline (downloading & caching if first run)...");
  const transcriber = await pipeline("automatic-speech-recognition", modelId, {
    dtype: "q8",
    progress_callback: (p) => {
      if (p.status === "progress") {
        process.stdout.write(`\r   Progress: [${p.file || "weights"}] ${Math.round(p.progress || 0)}%`);
      }
    },
  });

  const loadDuration = (performance.now() - loadStart).toFixed(2);
  const postLoadMem = ((process.memoryUsage().heapUsed - startMem) / (1024 * 1024)).toFixed(2);
  console.log(`\nModel initialized in ${loadDuration}ms (~${postLoadMem} MB heap increase).`);

  const audioPath = path.resolve("public/test-audio/jfk.wav");
  const audioBuffer = fs.readFileSync(audioPath);
  const audioData = parseWav(audioBuffer);
  console.log(`Loaded test audio: ${audioData.length} samples (${(audioData.length / 16000).toFixed(2)}s)`);

  console.log("\n2. Running Cold Inference (English test audio)...");
  const coldStart = performance.now();
  const coldResult = await transcriber(audioData);
  const coldDuration = (performance.now() - coldStart).toFixed(2);
  console.log(`Cold Inference Latency: ${coldDuration}ms`);
  console.log(`Cold Transcription: "${coldResult.text.trim()}"`);

  console.log("\n3. Running Warm Inference (reusing loaded model)...");
  const warmStart = performance.now();
  const warmResult = await transcriber(audioData);
  const warmDuration = (performance.now() - warmStart).toFixed(2);
  console.log(`Warm Inference Latency: ${warmDuration}ms`);
  console.log(`Warm Transcription: "${warmResult.text.trim()}"`);

  console.log("\n=== Test Completed Successfully ===");
}

main().catch(console.error);
