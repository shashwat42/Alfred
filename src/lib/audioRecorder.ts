import {
  AudioRecorderError,
  type AudioRecorderConfig,
  type RecordingResult,
  type RecordingState,
  type AudioLevelCallback,
  type RecordingStateCallback,
} from "../types/audio.ts";
import { decodeAndResampleAudio } from "./speechManager.ts";

const DEFAULT_MAX_DURATION_MS = 60000; // 60 seconds
const MIN_AUDIO_DURATION_MS = 250; // Minimum 250ms of audio
const DEFAULT_SPEECH_THRESHOLD = 0.035; // RMS threshold to register speech
const DEFAULT_SILENCE_DURATION_MS = 1500; // 1.5 seconds trailing silence
const DEFAULT_MIN_SPEECH_MS = 500; // 500ms minimum speech duration

export class AudioRecorder {
  private state: RecordingState = "inactive";
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private animationFrameId: number | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private recordedChunks: Blob[] = [];
  private isCancelled = false;
  private captureGeneration = 0;
  private activeConfig: AudioRecorderConfig = {};

  // Voice Activity / Turn Detection state
  private hasDetectedSpeech = false;
  private speechStartTime = 0;
  private lastSpeechTime = 0;
  private turnAutoStopping = false;

  private onLevelCallbacks = new Set<AudioLevelCallback>();
  private onStateCallbacks = new Set<RecordingStateCallback>();

  // Turn promise resolver for recordTurn()
  private turnResolver: {
    resolve: (res: RecordingResult) => void;
    reject: (err: Error) => void;
  } | null = null;

  public getState(): RecordingState {
    return this.state;
  }

  public isRecording(): boolean {
    return this.state === "recording";
  }

  public addLevelListener(callback: AudioLevelCallback): () => void {
    this.onLevelCallbacks.add(callback);
    return () => this.onLevelCallbacks.delete(callback);
  }

  public addStateListener(callback: RecordingStateCallback): () => void {
    this.onStateCallbacks.add(callback);
    callback(this.state);
    return () => this.onStateCallbacks.delete(callback);
  }

  private setState(state: RecordingState, error?: AudioRecorderError) {
    this.state = state;
    for (const cb of this.onStateCallbacks) {
      try {
        cb(this.state, error);
      } catch (err) {
        console.error("[AudioRecorder] Error in state callback:", err);
      }
    }
  }

  private emitLevel(level: number) {
    for (const cb of this.onLevelCallbacks) {
      try {
        cb(level);
      } catch (err) {
        console.error("[AudioRecorder] Error in level callback:", err);
      }
    }
  }

  /**
   * Starts microphone recording.
   * Prompts the user for microphone permissions if not already granted.
   */
  public async start(config: AudioRecorderConfig = {}): Promise<void> {
    if (this.state === "recording") {
      throw new AudioRecorderError("BUSY", "A recording is already in progress.");
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const err = new AudioRecorderError(
        "UNSUPPORTED",
        "Microphone audio recording is not supported in this environment."
      );
      this.setState("error", err);
      throw err;
    }

    this.isCancelled = false;
    const captureGeneration = ++this.captureGeneration;
    this.turnAutoStopping = false;
    this.hasDetectedSpeech = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.recordedChunks = [];
    this.activeConfig = config;
    this.cleanupAudioNodes();

    try {
      // 1. Request microphone permission on-demand
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: config.echoCancellation ?? true,
          noiseSuppression: config.noiseSuppression ?? true,
          autoGainControl: config.autoGainControl ?? true,
        },
      });

      if (captureGeneration !== this.captureGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        throw new AudioRecorderError("UNKNOWN", "Recording cancelled");
      }
      this.stream = stream;

      // 2. Set up live volume metering with Web Audio AnalyserNode
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        const ctx = new AudioContextClass();
        this.audioContext = ctx;
        // getUserMedia/model loading can outlast the original click. A suspended
        // context reports only silence, so turn detection would never complete.
        if (ctx.state === "suspended") await ctx.resume();
        if (captureGeneration !== this.captureGeneration) {
          throw new AudioRecorderError("UNKNOWN", "Recording cancelled");
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        this.analyserNode = analyser;

        this.startLevelMonitoring();
      } catch (analyserError) {
        if (captureGeneration !== this.captureGeneration || config.enableSilenceDetection) throw analyserError;
        console.warn("[AudioRecorder] Live volume visualizer setup warning:", analyserError);
      }

      // 3. Determine best supported mimeType for MediaRecorder
      let mimeType = "";
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/wav",
      ];
      for (const candidate of candidates) {
        if (MediaRecorder.isTypeSupported(candidate)) {
          mimeType = candidate;
          break;
        }
      }

      const recorderOptions: MediaRecorderOptions = {};
      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }

      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      this.mediaRecorder = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0 && !this.isCancelled) {
          this.recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onerror = (errEvent) => {
        console.error("[AudioRecorder] MediaRecorder error:", errEvent);
        const recError = new AudioRecorderError("UNKNOWN", "MediaRecorder failed during capture.");
        this.cleanup();
        this.setState("error", recError);
        if (this.turnResolver) {
          this.turnResolver.reject(recError);
          this.turnResolver = null;
        }
      };

      // 4. Start recording with 100ms timeslices for smooth buffering
      mediaRecorder.start(100);
      this.startTime = performance.now();
      this.setState("recording");

      // 5. Enforce 60-second maximum duration limit
      const maxDuration = config.maxDurationMs || DEFAULT_MAX_DURATION_MS;
      this.maxDurationTimer = setTimeout(() => {
        console.info(`[AudioRecorder] Maximum recording limit (${maxDuration / 1000}s) reached.`);
        if (this.state === "recording") {
          void this.stop();
        }
      }, maxDuration);
    } catch (err: unknown) {
      if (captureGeneration !== this.captureGeneration) throw err;
      this.cleanup();
      let recorderError: AudioRecorderError;

      if (err instanceof AudioRecorderError) {
        recorderError = err;
      } else if (err instanceof DOMException || (err as { name?: string }).name) {
        const domErr = err as { name: string; message: string };
        if (domErr.name === "NotAllowedError" || domErr.name === "PermissionDeniedError") {
          recorderError = new AudioRecorderError(
            "PERMISSION_DENIED",
            "Microphone permission was denied. Please allow microphone access to use voice input."
          );
        } else if (domErr.name === "NotFoundError" || domErr.name === "DevicesNotFoundError") {
          recorderError = new AudioRecorderError(
            "NO_DEVICE",
            "No audio recording device was found on this system."
          );
        } else {
          recorderError = new AudioRecorderError(
            "UNKNOWN",
            `Microphone access error: ${domErr.message || domErr.name}`
          );
        }
      } else {
        recorderError = new AudioRecorderError(
          "UNKNOWN",
          err instanceof Error ? err.message : String(err)
        );
      }

      this.setState("error", recorderError);
      if (this.turnResolver) {
        this.turnResolver.reject(recorderError);
        this.turnResolver = null;
      }
      throw recorderError;
    }
  }

  /**
   * Continuous Turn-by-Turn helper: Starts recording with silence detection
   * and returns a promise that resolves when speech ceases or max duration is hit.
   */
  public async recordTurn(config: AudioRecorderConfig = {}): Promise<RecordingResult> {
    return new Promise<RecordingResult>((resolve, reject) => {
      const turn = { resolve, reject };
      this.turnResolver = turn;
      const turnConfig: AudioRecorderConfig = {
        ...config,
        enableSilenceDetection: true,
      };

      this.start(turnConfig).catch((err) => {
        if (this.turnResolver === turn) {
          this.turnResolver.reject(err);
          this.turnResolver = null;
        }
      });
    });
  }

  /**
   * Stops recording and processes captured audio into 16,000 Hz mono Float32Array PCM.
   */
  public async stop(): Promise<RecordingResult> {
    if (this.state !== "recording" || !this.mediaRecorder) {
      throw new AudioRecorderError("UNKNOWN", "No active recording to stop.");
    }

    this.setState("processing");
    this.stopTimers();
    this.stopLevelMonitoring();

    const durationMs = Math.round(performance.now() - this.startTime);

    return new Promise<RecordingResult>((resolve, reject) => {
      const mediaRecorder = this.mediaRecorder;
      if (!mediaRecorder) {
        this.cleanup();
        const err = new AudioRecorderError("UNKNOWN", "Recorder instance lost during stop.");
        if (this.turnResolver) {
          this.turnResolver.reject(err);
          this.turnResolver = null;
        }
        reject(err);
        return;
      }

      mediaRecorder.onstop = async () => {
        try {
          if (this.isCancelled) {
            this.cleanup();
            const err = new AudioRecorderError("UNKNOWN", "Recording was cancelled.");
            if (this.turnResolver) {
              this.turnResolver.reject(err);
              this.turnResolver = null;
            }
            reject(err);
            return;
          }

          if (durationMs < MIN_AUDIO_DURATION_MS || this.recordedChunks.length === 0) {
            this.cleanup();
            const err = new AudioRecorderError("EMPTY_AUDIO", "Recorded audio is too short.");
            this.setState("error", err);
            if (this.turnResolver) {
              this.turnResolver.reject(err);
              this.turnResolver = null;
            }
            reject(err);
            return;
          }

          // Combine memory chunks into a single Blob
          const mimeType = mediaRecorder.mimeType || "audio/webm";
          const audioBlob = new Blob(this.recordedChunks, { type: mimeType });
          const arrayBuffer = await audioBlob.arrayBuffer();

          // Release hardware tracks immediately
          this.releaseTracks();

          // High-quality offline resampling to 16,000 Hz single-channel Float32Array
          const float32Pcm = await decodeAndResampleAudio(arrayBuffer, 16000);

          // Verify that audio is not completely silent (empty audio check)
          let hasSignal = false;
          const sampleCount = float32Pcm.length;
          for (let i = 0; i < sampleCount; i++) {
            if (Math.abs(float32Pcm[i]) > 0.003) {
              hasSignal = true;
              break;
            }
          }

          if (!hasSignal) {
            this.cleanup();
            const err = new AudioRecorderError(
              "EMPTY_AUDIO",
              "Recorded audio contains no audible speech (silence)."
            );
            this.setState("error", err);
            if (this.turnResolver) {
              this.turnResolver.reject(err);
              this.turnResolver = null;
            }
            reject(err);
            return;
          }

          this.cleanup();
          this.setState("inactive");

          const result: RecordingResult = {
            audio: float32Pcm,
            durationMs,
            sampleRate: 16000,
          };

          if (this.turnResolver) {
            this.turnResolver.resolve(result);
            this.turnResolver = null;
          }

          resolve(result);
        } catch (err) {
          this.cleanup();
          const procError = new AudioRecorderError(
            "UNKNOWN",
            `Failed to decode recorded audio: ${err instanceof Error ? err.message : String(err)}`
          );
          this.setState("error", procError);
          if (this.turnResolver) {
            this.turnResolver.reject(procError);
            this.turnResolver = null;
          }
          reject(procError);
        }
      };

      try {
        if (mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
      } catch (err) {
        this.cleanup();
        reject(err);
      }
    });
  }

  /**
   * Cancels the active recording session and discards all buffers immediately.
   */
  public cancel(): void {
    // Permission may still be pending while state is inactive. Invalidate that
    // request too, and immediately stop any stream it later returns.
    this.captureGeneration++;
    this.isCancelled = true;
    this.stopTimers();
    this.stopLevelMonitoring();

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore errors during emergency stop
      }
    }

    this.cleanup();
    this.setState("inactive");

    if (this.turnResolver) {
      this.turnResolver.reject(new AudioRecorderError("UNKNOWN", "Recording cancelled"));
      this.turnResolver = null;
    }
  }

  private startLevelMonitoring() {
    if (!this.analyserNode) return;
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    const speechThreshold = this.activeConfig.speechThreshold ?? DEFAULT_SPEECH_THRESHOLD;
    const silenceDurationMs = this.activeConfig.silenceDurationMs ?? DEFAULT_SILENCE_DURATION_MS;
    const minSpeechDurationMs = this.activeConfig.minSpeechDurationMs ?? DEFAULT_MIN_SPEECH_MS;
    const enableVAD = Boolean(this.activeConfig.enableSilenceDetection);

    const update = () => {
      if (this.state !== "recording" || !this.analyserNode) {
        this.emitLevel(0);
        return;
      }

      this.analyserNode.getByteTimeDomainData(dataArray);

      // Compute RMS volume level (0.0 to 1.0)
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const level = Math.min(1, Math.max(0, rms * 3.5)); // Scale for UI visibility

      this.emitLevel(level);

      // Voice Activity / Silence Turn Detection
      if (enableVAD && !this.turnAutoStopping) {
        const now = Date.now();
        if (rms >= speechThreshold) {
          if (!this.hasDetectedSpeech) {
            this.hasDetectedSpeech = true;
            this.speechStartTime = now;
          }
          this.lastSpeechTime = now;
        } else if (this.hasDetectedSpeech) {
          const silenceDuration = now - this.lastSpeechTime;
          const totalSpeechDuration = this.lastSpeechTime - this.speechStartTime;

          // If user spoke for at least minSpeechDurationMs and has paused for silenceDurationMs
          if (silenceDuration >= silenceDurationMs && totalSpeechDuration >= minSpeechDurationMs) {
            this.turnAutoStopping = true;
            if (this.activeConfig.onTurnDetected) {
              try {
                this.activeConfig.onTurnDetected();
              } catch (err) {
                console.error("[AudioRecorder] Error in onTurnDetected callback:", err);
              }
            }
            void this.stop();
            return;
          }
        }
      }

      this.animationFrameId = requestAnimationFrame(update);
    };

    this.animationFrameId = requestAnimationFrame(update);
  }

  private stopLevelMonitoring() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.emitLevel(0);
  }

  private stopTimers() {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private releaseTracks() {
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false;
        });
      } catch (err) {
        console.warn("[AudioRecorder] Error stopping tracks:", err);
      }
      this.stream = null;
    }
  }

  private cleanupAudioNodes() {
    this.stopLevelMonitoring();
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        void this.audioContext.close();
      } catch {
        // Ignore closing errors
      }
      this.audioContext = null;
    }
    this.analyserNode = null;
  }

  private cleanup() {
    this.stopTimers();
    this.releaseTracks();
    this.cleanupAudioNodes();
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.turnAutoStopping = false;
  }
}

export const audioRecorder = new AudioRecorder();
