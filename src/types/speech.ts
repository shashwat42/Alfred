export type SpeechModelId =
  | "onnx-community/whisper-tiny.en"
  | "onnx-community/whisper-tiny"
  | "onnx-community/whisper-base";

export type SpeechDevice = "webgpu" | "wasm";

export type ModelLoadingStatus =
  | "idle"
  | "downloading"
  | "compiling"
  | "ready"
  | "error";

export interface ModelProgressInfo {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
  file?: string;
  name?: string;
}

export interface TranscribeOptions {
  language?: string | null;
  task?: "transcribe" | "translate";
  modelId?: SpeechModelId;
  devicePreference?: SpeechDevice;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs: number;
  device: SpeechDevice;
}

export type WorkerIncomingMessage =
  | {
      type: "LOAD_MODEL";
      model?: SpeechModelId;
      devicePreference?: SpeechDevice;
    }
  | {
      type: "TRANSCRIBE";
      requestId: string;
      audio: Float32Array;
      options?: TranscribeOptions;
    }
  | {
      type: "CANCEL_TRANSCRIBE";
      requestId: string;
    };

export type WorkerOutgoingMessage =
  | {
      type: "MODEL_STATUS";
      status: ModelLoadingStatus;
      device?: SpeechDevice;
      error?: string;
    }
  | {
      type: "MODEL_PROGRESS";
      progress: number;
      file?: string;
      loaded?: number;
      total?: number;
    }
  | {
      type: "TRANSCRIBE_SUCCESS";
      requestId: string;
      result: TranscriptionResult;
    }
  | {
      type: "TRANSCRIBE_ERROR";
      requestId: string;
      error: string;
    };
