import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import type {
  SpeechModelId,
  SpeechDevice,
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from "../types/speech";

// Configure Transformers.js environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// Configure ONNX backend options
if (env.backends?.onnx?.wasm) {
  // Avoid nested web-workers inside this worker
  env.backends.onnx.wasm.proxy = false;
  // Baseline reliability: set numThreads = 1 to prevent nested pthread deadlock inside worker
  env.backends.onnx.wasm.numThreads = 1;
  // The isolated Android assistant forbids CDN scripts. Use the installed,
  // version-matched runtime served from its APK; other app routes keep defaults.
  if (self.name === "alfred-android-assistant") {
    env.backends.onnx.wasm.wasmPaths = new URL("/speech-runtime/", self.location.origin).href;
  }
}

let currentModelId: SpeechModelId = "onnx-community/whisper-tiny.en";
let currentDevice: SpeechDevice = "wasm";
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let initPromise: Promise<{ transcriber: AutomaticSpeechRecognitionPipeline; device: SpeechDevice }> | null = null;
const cancelledRequests = new Set<string>();

function postMsg(message: WorkerOutgoingMessage) {
  self.postMessage(message);
}

async function getTranscriber(
  modelId: SpeechModelId = "onnx-community/whisper-tiny.en",
  preferredDevice?: SpeechDevice
): Promise<{ transcriber: AutomaticSpeechRecognitionPipeline; device: SpeechDevice }> {
  if (transcriber && currentModelId === modelId) {
    return { transcriber, device: currentDevice };
  }

  // Deduplicate concurrent initialization: await active promise if loading
  if (initPromise) {
    return initPromise;
  }

  const startTime = performance.now();
  console.info(`[SpeechWorker] Starting model initialization for ${modelId}...`);

  initPromise = (async () => {
    postMsg({ type: "MODEL_STATUS", status: "downloading" });

    const progressCallback = (data: {
      status?: string;
      progress?: number;
      loaded?: number;
      total?: number;
      file?: string;
    }) => {
      if (data.status === "progress" && typeof data.progress === "number") {
        postMsg({
          type: "MODEL_PROGRESS",
          progress: data.progress,
          file: data.file,
          loaded: data.loaded,
          total: data.total,
        });
      } else if (data.status === "ready" || data.status === "done") {
        postMsg({ type: "MODEL_STATUS", status: "compiling" });
      }
    };

    try {
      if (preferredDevice === "webgpu") {
        try {
          console.info(`[SpeechWorker] Attempting WebGPU pipeline for ${modelId}...`);
          const pipe = (await pipeline("automatic-speech-recognition", modelId, {
            device: "webgpu",
            dtype: "fp32",
            progress_callback: progressCallback,
          })) as AutomaticSpeechRecognitionPipeline;

          transcriber = pipe;
          currentModelId = modelId;
          currentDevice = "webgpu";
          const initDuration = Math.round(performance.now() - startTime);
          console.info(`[SpeechWorker] Model ready on WebGPU in ${initDuration}ms`);
          postMsg({ type: "MODEL_STATUS", status: "ready", device: "webgpu" });
          return { transcriber, device: "webgpu" };
        } catch (gpuError) {
          console.warn(
            "[SpeechWorker] WebGPU initialization failed. Falling back to WASM/CPU:",
            gpuError
          );
        }
      }

      // High-performance, portable WASM SIMD Q8 (~41MB) baseline
      console.info(`[SpeechWorker] Loading ${modelId} on WASM CPU (q8)...`);
      const pipe = (await pipeline("automatic-speech-recognition", modelId, {
        device: "wasm",
        dtype: "q8",
        progress_callback: progressCallback,
      })) as AutomaticSpeechRecognitionPipeline;

      transcriber = pipe;
      currentModelId = modelId;
      currentDevice = "wasm";
      const initDuration = Math.round(performance.now() - startTime);
      console.info(`[SpeechWorker] Model ready on WASM in ${initDuration}ms`);
      postMsg({ type: "MODEL_STATUS", status: "ready", device: "wasm" });
      return { transcriber, device: "wasm" };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[SpeechWorker] Model loading failed:`, errorMsg);
      postMsg({ type: "MODEL_STATUS", status: "error", error: errorMsg });
      throw err;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

self.addEventListener("message", async (e: MessageEvent<WorkerIncomingMessage>) => {
  const data = e.data;

  if (data.type === "CANCEL_TRANSCRIBE") {
    cancelledRequests.add(data.requestId);
    console.info(`[SpeechWorker] Request marked as cancelled: ${data.requestId}`);
    return;
  }

  if (data.type === "LOAD_MODEL") {
    const modelToLoad = data.model || currentModelId;
    try {
      await getTranscriber(modelToLoad, data.devicePreference);
    } catch {
      // getTranscriber already posts error status
    }
    return;
  }

  if (data.type === "TRANSCRIBE") {
    const { requestId, audio, options } = data;
    const startTime = performance.now();

    // Verify audio sanity
    if (!audio || !(audio instanceof Float32Array) || audio.length === 0) {
      postMsg({
        type: "TRANSCRIBE_ERROR",
        requestId,
        error: "Invalid or empty audio buffer passed to worker.",
      });
      return;
    }

    try {
      const modelToUse = options?.modelId || currentModelId;
      const { transcriber: activePipe, device } = await getTranscriber(
        modelToUse,
        options?.devicePreference
      );

      // Check if request was cancelled while waiting for model initialization
      if (cancelledRequests.has(requestId)) {
        cancelledRequests.delete(requestId);
        console.info(`[SpeechWorker] Request ${requestId} cancelled before inference.`);
        return;
      }

      console.info(
        `[SpeechWorker] Running inference for req=${requestId}: samples=${audio.length}, duration=${(
          audio.length / 16000
        ).toFixed(2)}s on ${device}`
      );

      const pipelineOptions: Record<string, unknown> = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      };

      if (options?.language && !modelToUse.endsWith(".en")) {
        pipelineOptions.language = options.language;
      }
      if (options?.task && !modelToUse.endsWith(".en")) {
        pipelineOptions.task = options.task;
      }

      const output = await activePipe(audio, pipelineOptions);
      const durationMs = Math.round(performance.now() - startTime);

      // Check if request was cancelled while inference was running
      if (cancelledRequests.has(requestId)) {
        cancelledRequests.delete(requestId);
        console.info(`[SpeechWorker] Request ${requestId} cancelled after inference.`);
        return;
      }

      let recognizedText = "";
      if (typeof output === "string") {
        recognizedText = output;
      } else if (Array.isArray(output) && output.length > 0) {
        recognizedText = output[0]?.text || "";
      } else if (output && typeof output === "object" && "text" in output) {
        recognizedText = (output as { text: string }).text;
      }

      console.info(`[SpeechWorker] Inference complete for req=${requestId} in ${durationMs}ms`);

      postMsg({
        type: "TRANSCRIBE_SUCCESS",
        requestId,
        result: {
          text: recognizedText.trim(),
          language: options?.language || undefined,
          durationMs,
          device,
        },
      });
    } catch (err: unknown) {
      if (cancelledRequests.has(requestId)) {
        cancelledRequests.delete(requestId);
        return;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[SpeechWorker] Inference error for req=${requestId}:`, errorMsg);
      postMsg({
        type: "TRANSCRIBE_ERROR",
        requestId,
        error: errorMsg,
      });
    }
  }
});
