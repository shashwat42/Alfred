import type {
  SpeechModelId,
  SpeechDevice,
  ModelLoadingStatus,
  ModelProgressInfo,
  TranscribeOptions,
  TranscriptionResult,
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from "../types/speech";

export type StatusListener = (status: ModelLoadingStatus, device?: SpeechDevice, error?: string) => void;
export type ProgressListener = (info: ModelProgressInfo) => void;

interface PendingRequest {
  resolve: (result: TranscriptionResult) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

class SpeechManager {
  private worker: Worker | null = null;
  private status: ModelLoadingStatus = "idle";
  private device: SpeechDevice = "wasm";
  private lastError: string | null = null;
  private statusListeners = new Set<StatusListener>();
  private progressListeners = new Set<ProgressListener>();
  private pendingRequests = new Map<string, PendingRequest>();
  private initPromise: Promise<void> | null = null;

  public getStatus(): ModelLoadingStatus {
    return this.status;
  }

  public getDevice(): SpeechDevice {
    return this.device;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.device, this.lastError || undefined);
    return () => this.statusListeners.delete(listener);
  }

  public addProgressListener(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private notifyStatus(status: ModelLoadingStatus, device?: SpeechDevice, error?: string) {
    this.status = status;
    if (device) this.device = device;
    if (error) this.lastError = error;
    for (const listener of this.statusListeners) {
      try {
        listener(this.status, this.device, this.lastError || undefined);
      } catch (err) {
        console.error("[SpeechManager] Error in status listener:", err);
      }
    }
  }

  private notifyProgress(info: ModelProgressInfo) {
    for (const listener of this.progressListeners) {
      try {
        listener(info);
      } catch (err) {
        console.error("[SpeechManager] Error in progress listener:", err);
      }
    }
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("../workers/speech.worker.ts", import.meta.url),
        { type: "module" }
      );

      this.worker.onmessage = (e: MessageEvent<WorkerOutgoingMessage>) => {
        this.handleWorkerMessage(e.data);
      };

      this.worker.onerror = (err) => {
        const errorMsg = `Speech Web Worker error: ${err.message || "Unknown worker error"}`;
        console.error("[SpeechManager]", errorMsg);
        this.notifyStatus("error", undefined, errorMsg);
        this.cancelAllPendingRequests(`Worker error: ${errorMsg}`);
      };
    }
    return this.worker;
  }

  private handleWorkerMessage(data: WorkerOutgoingMessage) {
    switch (data.type) {
      case "MODEL_STATUS":
        this.notifyStatus(data.status, data.device, data.error);
        break;

      case "MODEL_PROGRESS":
        this.notifyProgress({
          status: "downloading",
          progress: data.progress,
          file: data.file,
          loaded: data.loaded,
          total: data.total,
        });
        break;

      case "TRANSCRIBE_SUCCESS": {
        const req = this.pendingRequests.get(data.requestId);
        if (req) {
          req.resolve(data.result);
        }
        break;
      }

      case "TRANSCRIBE_ERROR": {
        const req = this.pendingRequests.get(data.requestId);
        if (req) {
          req.reject(new Error(data.error));
        }
        break;
      }
    }
  }

  /**
   * Ensures the model is loaded with its own decoupled download/compilation timeout.
   * Concurrent calls share the same initialization promise.
   */
  public async ensureModelLoaded(
    modelId: SpeechModelId = "onnx-community/whisper-tiny.en",
    devicePreference?: SpeechDevice,
    timeoutMs = 180000
  ): Promise<void> {
    if (this.status === "ready") {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    const worker = this.ensureWorker();
    const startTime = performance.now();
    console.info(
      `[SpeechManager] Initializing speech model: ${modelId} (device=${devicePreference || "auto"})`
    );

    this.initPromise = new Promise<void>((resolve, reject) => {
      let isSettled = false;

      const timeoutId = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          unsubscribe();
          this.initPromise = null;
          reject(
            new Error(
              `Model download/initialization timed out after ${timeoutMs / 1000}s. Please check your internet connection.`
            )
          );
        }
      }, timeoutMs);

      const unsubscribe = this.addStatusListener((status, device, error) => {
        if (isSettled) return;

        if (status === "ready") {
          isSettled = true;
          clearTimeout(timeoutId);
          unsubscribe();
          this.initPromise = null;
          const elapsed = Math.round(performance.now() - startTime);
          console.info(
            `[SpeechManager] Speech model ready in ${elapsed}ms (device=${device || this.device})`
          );
          resolve();
        } else if (status === "error") {
          isSettled = true;
          clearTimeout(timeoutId);
          unsubscribe();
          this.initPromise = null;
          const err = new Error(error || "Failed to initialize speech model");
          console.error("[SpeechManager] Speech model loading error:", err);
          reject(err);
        }
      });

      const message: WorkerIncomingMessage = {
        type: "LOAD_MODEL",
        model: modelId,
        devicePreference,
      };
      worker.postMessage(message);
    });

    return this.initPromise;
  }

  public async initModel(
    modelId: SpeechModelId = "onnx-community/whisper-tiny.en",
    devicePreference?: SpeechDevice
  ): Promise<void> {
    return this.ensureModelLoaded(modelId, devicePreference);
  }

  /**
   * Transcribes resampled 16 kHz Float32 PCM audio with a dedicated inference-only timeout.
   */
  public async transcribe(
    audio: Float32Array,
    options?: TranscribeOptions,
    timeoutMs = 45000
  ): Promise<TranscriptionResult> {
    if (!audio || !(audio instanceof Float32Array) || audio.length === 0) {
      throw new Error("Invalid or empty audio buffer passed to transcribe.");
    }

    const durationSec = audio.length / 16000;
    const modelToUse = options?.modelId || "onnx-community/whisper-tiny.en";

    console.info(
      `[SpeechManager] transcribe() queued: samples=${audio.length}, duration=${durationSec.toFixed(
        2
      )}s, model=${modelToUse}`
    );

    // 1. Decoupled check: Ensure model is initialized FIRST before starting inference timer
    await this.ensureModelLoaded(modelToUse, options?.devicePreference);

    const worker = this.ensureWorker();
    const requestId = `stt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startTime = performance.now();

    return new Promise<TranscriptionResult>((resolve, reject) => {
      let isSettled = false;

      const timeoutId = setTimeout(() => {
        if (!isSettled && this.pendingRequests.has(requestId)) {
          isSettled = true;
          this.pendingRequests.delete(requestId);

          try {
            worker.postMessage({ type: "CANCEL_TRANSCRIBE", requestId });
          } catch {
            // Worker may be inactive
          }

          console.error(
            `[SpeechManager] Pure inference timed out for req=${requestId} after ${timeoutMs / 1000}s`
          );
          reject(new Error(`Speech transcription timed out after ${timeoutMs / 1000}s`));
        }
      }, timeoutMs);

      const safeResolve = (result: TranscriptionResult) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        const roundTripMs = Math.round(performance.now() - startTime);
        console.info(
          `[SpeechManager] req=${requestId} complete: roundTrip=${roundTripMs}ms, inference=${result.durationMs}ms, device=${result.device}`
        );
        resolve(result);
      };

      const safeReject = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        console.warn(`[SpeechManager] req=${requestId} failed:`, err.message);
        reject(err);
      };

      this.pendingRequests.set(requestId, {
        resolve: safeResolve,
        reject: safeReject,
        timeoutId,
      });

      const message: WorkerIncomingMessage = {
        type: "TRANSCRIBE",
        requestId,
        audio,
        options,
      };

      try {
        worker.postMessage(message, [audio.buffer]);
      } catch {
        worker.postMessage(message);
      }
    });
  }

  public cancelRequest(requestId: string, reason = "Transcription cancelled"): void {
    const req = this.pendingRequests.get(requestId);
    if (req) {
      req.reject(new Error(reason));
      if (this.worker) {
        try {
          this.worker.postMessage({ type: "CANCEL_TRANSCRIBE", requestId });
        } catch {
          // ignore
        }
      }
    }
  }

  public cancelAllPendingRequests(reason = "Transcription cancelled"): void {
    if (this.pendingRequests.size === 0) return;
    console.info(
      `[SpeechManager] Cancelling ${this.pendingRequests.size} pending requests: ${reason}`
    );
    for (const [id, req] of Array.from(this.pendingRequests.entries())) {
      req.reject(new Error(reason));
      if (this.worker) {
        try {
          this.worker.postMessage({ type: "CANCEL_TRANSCRIBE", requestId: id });
        } catch {
          // ignore
        }
      }
    }
    this.pendingRequests.clear();
  }

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.cancelAllPendingRequests("Speech worker terminated");
    this.initPromise = null;
    this.notifyStatus("idle");
  }
}

/**
 * Decodes and resamples an audio ArrayBuffer (WAV, OGG, MP3) down to 16,000 Hz mono PCM Float32Array
 */
export async function decodeAndResampleAudio(
  arrayBuffer: ArrayBuffer,
  targetSampleRate = 16000
): Promise<Float32Array> {
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const audioCtx = new AudioContextClass();
  try {
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

    if (decodedBuffer.sampleRate === targetSampleRate && decodedBuffer.numberOfChannels === 1) {
      return decodedBuffer.getChannelData(0);
    }

    // High quality offline resampling
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil(decodedBuffer.duration * targetSampleRate),
      targetSampleRate
    );

    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = decodedBuffer;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start(0);

    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0);
  } finally {
    void audioCtx.close();
  }
}

export const speechManager = new SpeechManager();
