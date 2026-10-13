export type RecordingState = "inactive" | "recording" | "processing" | "error";

export type VoiceModeState =
  | "off"
  | "starting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "error";

export type AudioRecorderErrorCode =
  | "PERMISSION_DENIED"
  | "NO_DEVICE"
  | "EMPTY_AUDIO"
  | "UNSUPPORTED"
  | "RECORDING_TIMEOUT"
  | "BUSY"
  | "UNKNOWN";

export class AudioRecorderError extends Error {
  public readonly code: AudioRecorderErrorCode;

  constructor(code: AudioRecorderErrorCode, message: string) {
    super(message);
    this.name = "AudioRecorderError";
    this.code = code;
  }
}

export interface AudioRecorderConfig {
  maxDurationMs?: number; // Defaults to 60000ms (60s)
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  enableSilenceDetection?: boolean;
  speechThreshold?: number; // RMS threshold to register speech (default: 0.035)
  silenceDurationMs?: number; // Silence duration to conclude turn (default: 1500ms)
  minSpeechDurationMs?: number; // Minimum speech duration before silence can trigger (default: 500ms)
  onTurnDetected?: () => void;
}

export interface RecordingResult {
  audio: Float32Array; // 16,000 Hz mono PCM
  durationMs: number;
  sampleRate: number; // 16,000
}

export type AudioLevelCallback = (level: number) => void;
export type RecordingStateCallback = (state: RecordingState, error?: AudioRecorderError) => void;
export type RecordingTimeoutCallback = () => void;
