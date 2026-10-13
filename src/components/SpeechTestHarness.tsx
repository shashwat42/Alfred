import { useState, useEffect, useRef } from "react";
import {
  speechManager,
  decodeAndResampleAudio,
} from "../lib/speechManager";
import { audioRecorder } from "../lib/audioRecorder";
import type {
  SpeechModelId,
  SpeechDevice,
  ModelLoadingStatus,
  ModelProgressInfo,
  TranscriptionResult,
} from "../types/speech";
import type { RecordingState } from "../types/audio";

export default function SpeechTestHarness() {
  const [isOpen, setIsOpen] = useState(false);
  const [modelId, setModelId] = useState<SpeechModelId>("onnx-community/whisper-tiny");
  const [devicePref, setDevicePref] = useState<SpeechDevice | "auto">("auto");
  const [status, setStatus] = useState<ModelLoadingStatus>("idle");
  const [activeDevice, setActiveDevice] = useState<SpeechDevice>("wasm");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressInfo, setProgressInfo] = useState<ModelProgressInfo | null>(null);

  // Audio fixture state
  const [selectedAudio, setSelectedAudio] = useState<"jfk" | "hindi" | "custom">("jfk");
  const [customAudioBuffer, setCustomAudioBuffer] = useState<ArrayBuffer | null>(null);
  const [customFileName, setCustomFileName] = useState<string>("");

  // Live microphone recording state
  const [recordingState, setRecordingState] = useState<RecordingState>("inactive");
  const [recordingDurationSec, setRecordingDurationSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micLanguage, setMicLanguage] = useState<"auto" | "en" | "hi">("auto");

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [cachedFilesCount, setCachedFilesCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Subscribe to speechManager events
  useEffect(() => {
    const unsubStatus = speechManager.addStatusListener((s, dev, err) => {
      setStatus(s);
      if (dev) setActiveDevice(dev);
      if (err) setErrorMessage(err);
    });

    const unsubProgress = speechManager.addProgressListener((info) => {
      setProgressInfo(info);
    });

    const unsubRecState = audioRecorder.addStateListener((state, err) => {
      setRecordingState(state);
      if (err) {
        setErrorMessage(err.message);
      }
    });

    const unsubRecLevel = audioRecorder.addLevelListener((level) => {
      setAudioLevel(level);
    });

    checkCache();

    return () => {
      unsubStatus();
      unsubProgress();
      unsubRecState();
      unsubRecLevel();
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      audioRecorder.cancel();
    };
  }, []);

  const checkCache = async () => {
    try {
      if (typeof window !== "undefined" && "caches" in window) {
        const cacheNames = await window.caches.keys();
        let total = 0;
        for (const name of cacheNames) {
          if (name.includes("transformers") || name.includes("hf") || name.includes("onnx")) {
            const cache = await window.caches.open(name);
            const keys = await cache.keys();
            total += keys.length;
          }
        }
        setCachedFilesCount(total);
      }
    } catch {
      setCachedFilesCount(null);
    }
  };

  const handleInitModel = async () => {
    setErrorMessage(null);
    setTranscriptionResult(null);
    try {
      const pref = devicePref === "auto" ? undefined : devicePref;
      await speechManager.initModel(modelId, pref);
      await checkCache();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCustomFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCustomFileName(file.name);
      const buf = await file.arrayBuffer();
      setCustomAudioBuffer(buf);
      setSelectedAudio("custom");
    }
  };

  // --- Live Microphone Recording Handlers ---
  const handleStartRecording = async () => {
    setErrorMessage(null);
    setTranscriptionResult(null);
    setRecordingDurationSec(0);

    try {
      await audioRecorder.start({ maxDurationMs: 60000 });

      // Start elapsed timer
      const startTime = Date.now();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingDurationSec(elapsed);
        if (elapsed >= 60) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        }
      }, 250);
    } catch (err: unknown) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopRecordingAndTranscribe = async () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    try {
      const recordingResult = await audioRecorder.stop();

      // Automatically run local Whisper transcription
      setIsTranscribing(true);
      const lang = micLanguage === "auto" ? null : micLanguage;
      const result = await speechManager.transcribe(recordingResult.audio, {
        language: lang,
        task: "transcribe",
      });

      setTranscriptionResult(result);
      await checkCache();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranscribing(false);
      setRecordingDurationSec(0);
    }
  };

  const handleCancelRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    audioRecorder.cancel();
    setRecordingDurationSec(0);
    setErrorMessage(null);
  };

  // --- Audio Fixture Transcription Handler ---
  const handleRunFixtureTranscription = async () => {
    setIsTranscribing(true);
    setErrorMessage(null);
    setTranscriptionResult(null);

    try {
      let arrayBuffer: ArrayBuffer;
      let languageOption: string | null = null;

      if (selectedAudio === "jfk") {
        const res = await fetch("/test-audio/jfk.wav");
        if (!res.ok) throw new Error(`Failed to load /test-audio/jfk.wav (${res.status})`);
        arrayBuffer = await res.arrayBuffer();
        languageOption = "en";
      } else if (selectedAudio === "hindi") {
        const res = await fetch("/test-audio/hindi.ogg");
        if (!res.ok) throw new Error(`Failed to load /test-audio/hindi.ogg (${res.status})`);
        arrayBuffer = await res.arrayBuffer();
        languageOption = "hi";
      } else {
        if (!customAudioBuffer) throw new Error("No custom audio file chosen");
        arrayBuffer = customAudioBuffer;
      }

      // High-quality offline decoding and downsampling to 16kHz mono Float32Array
      const audioPcm = await decodeAndResampleAudio(arrayBuffer, 16000);

      const result = await speechManager.transcribe(audioPcm, {
        language: languageOption,
        task: "transcribe",
      });

      setTranscriptionResult(result);
      await checkCache();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTranscribing(false);
    }
  };

  // Only active in DEV mode
  if (!import.meta.env.DEV) {
    return null;
  }

  const isRecordingActive = recordingState === "recording";
  const isProcessingAudio = recordingState === "processing";

  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        left: "16px",
        zIndex: 9999,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          style={{
            background: isRecordingActive ? "#dc2626" : "#2563eb",
            color: "#ffffff",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "20px",
            padding: "8px 14px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            transition: "background 0.2s ease",
          }}
          title="Open Phase 4 Speech Inference Test Harness"
        >
          <span>{isRecordingActive ? "🔴 Recording..." : "🎙️ STT PoC Test"}</span>
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background:
                isRecordingActive
                  ? "#ef4444"
                  : status === "ready"
                  ? "#22c55e"
                  : status === "downloading" || status === "compiling"
                  ? "#f59e0b"
                  : status === "error"
                  ? "#ef4444"
                  : "#94a3b8",
            }}
          />
        </button>
      ) : (
        <div
          style={{
            width: "380px",
            maxHeight: "620px",
            background: "#18181b",
            color: "#f4f4f5",
            borderRadius: "12px",
            border: "1px solid #27272a",
            boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            fontSize: "13px",
            overflowY: "auto",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #27272a",
              paddingBottom: "8px",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>🎙️ Phase 4 STT & Mic Test</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "#a1a1aa",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Model Status & Device Box */}
          <div
            style={{
              background: "#27272a",
              borderRadius: "8px",
              padding: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>Model Status:</span>
              <span
                style={{
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color:
                    status === "ready"
                      ? "#4ade80"
                      : status === "downloading" || status === "compiling"
                      ? "#fbbf24"
                      : status === "error"
                      ? "#f87171"
                      : "#94a3b8",
                }}
              >
                {status}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>Execution Device:</span>
              <span style={{ fontWeight: 600, color: "#38bdf8" }}>{activeDevice.toUpperCase()}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>Cache Storage:</span>
              <span style={{ fontWeight: 600 }}>
                {cachedFilesCount !== null ? `${cachedFilesCount} files cached` : "Checking..."}
              </span>
            </div>

            {progressInfo && (status === "downloading" || status === "compiling") && (
              <div style={{ marginTop: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#a1a1aa" }}>
                  <span>{progressInfo.file || "Loading weights..."}</span>
                  <span>{Math.round(progressInfo.progress || 0)}%</span>
                </div>
                <div
                  style={{
                    height: "6px",
                    background: "#3f3f46",
                    borderRadius: "3px",
                    overflow: "hidden",
                    marginTop: "4px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${progressInfo.progress || 0}%`,
                      background: "#2563eb",
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Model Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: "11px", color: "#a1a1aa", display: "block", marginBottom: "3px" }}>
                  Model:
                </label>
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value as SpeechModelId)}
                  disabled={status === "downloading" || status === "compiling" || isTranscribing || isRecordingActive}
                  style={{
                    width: "100%",
                    background: "#27272a",
                    color: "#f4f4f5",
                    border: "1px solid #3f3f46",
                    borderRadius: "6px",
                    padding: "5px 6px",
                    fontSize: "11px",
                  }}
                >
                  <option value="onnx-community/whisper-tiny">whisper-tiny (~41MB)</option>
                  <option value="onnx-community/whisper-base">whisper-base (~77MB)</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: "11px", color: "#a1a1aa", display: "block", marginBottom: "3px" }}>
                  Device:
                </label>
                <select
                  value={devicePref}
                  onChange={(e) => setDevicePref(e.target.value as SpeechDevice | "auto")}
                  disabled={status === "downloading" || status === "compiling" || isTranscribing || isRecordingActive}
                  style={{
                    width: "100%",
                    background: "#27272a",
                    color: "#f4f4f5",
                    border: "1px solid #3f3f46",
                    borderRadius: "6px",
                    padding: "5px 6px",
                    fontSize: "11px",
                  }}
                >
                  <option value="auto">Auto (GPU/CPU)</option>
                  <option value="webgpu">Force WebGPU</option>
                  <option value="wasm">Force WASM</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={handleInitModel}
              disabled={status === "downloading" || status === "compiling" || isTranscribing || isRecordingActive}
              style={{
                background: status === "ready" ? "#27272a" : "#2563eb",
                color: "#ffffff",
                border: "1px solid #3f3f46",
                borderRadius: "6px",
                padding: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {status === "ready" ? "Reload Model" : "Initialize Model"}
            </button>
          </div>

          {/* Section: Live Microphone Push-to-Talk Recording */}
          <div
            style={{
              borderTop: "1px solid #27272a",
              paddingTop: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, color: "#e4e4e7" }}>Live Microphone Capture:</span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "11px", color: "#a1a1aa" }}>Lang:</span>
                <select
                  value={micLanguage}
                  onChange={(e) => setMicLanguage(e.target.value as "auto" | "en" | "hi")}
                  disabled={isRecordingActive || isTranscribing}
                  style={{
                    background: "#27272a",
                    color: "#f4f4f5",
                    border: "1px solid #3f3f46",
                    borderRadius: "4px",
                    padding: "2px 4px",
                    fontSize: "11px",
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="en">English (en)</option>
                  <option value="hi">Hindi (hi)</option>
                </select>
              </div>
            </div>

            {/* Live Visualizer and Timer Bar when Recording */}
            {isRecordingActive && (
              <div
                style={{
                  background: "#1c1917",
                  border: "1px solid #78350f",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <span style={{ color: "#ef4444", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444" }} />
                    RECORDING (Max 60s)
                  </span>
                  <span style={{ color: "#f59e0b", fontFamily: "monospace", fontWeight: 700 }}>
                    {String(Math.floor(recordingDurationSec / 60)).padStart(2, "0")}:
                    {String(recordingDurationSec % 60).padStart(2, "0")} / 01:00
                  </span>
                </div>

                {/* Volume Level Meter Bar */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "10px", color: "#a1a1aa" }}>MIC LEVEL:</span>
                  <div
                    style={{
                      flex: 1,
                      height: "8px",
                      background: "#292524",
                      borderRadius: "4px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.round(audioLevel * 100)}%`,
                        background: audioLevel > 0.8 ? "#ef4444" : audioLevel > 0.4 ? "#22c55e" : "#3b82f6",
                        transition: "width 0.05s ease",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Mic Action Buttons */}
            <div style={{ display: "flex", gap: "8px" }}>
              {!isRecordingActive ? (
                <button
                  type="button"
                  onClick={handleStartRecording}
                  disabled={isProcessingAudio || isTranscribing || status !== "ready"}
                  style={{
                    flex: 1,
                    background: status !== "ready" ? "#3f3f46" : "#dc2626",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "9px",
                    fontWeight: 600,
                    cursor: status !== "ready" ? "not-allowed" : "pointer",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>🎙️ Start Mic Recording</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleStopRecordingAndTranscribe}
                    style={{
                      flex: 2,
                      background: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "9px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ⏹ Stop & Transcribe
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRecording}
                    style={{
                      flex: 1,
                      background: "#3f3f46",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "9px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Section: Offline Audio Fixture Tests */}
          <div
            style={{
              borderTop: "1px solid #27272a",
              paddingTop: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <label style={{ fontSize: "11px", color: "#a1a1aa", display: "block" }}>
              Audio Fixtures (Offline Verification):
            </label>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                onClick={() => setSelectedAudio("jfk")}
                disabled={isRecordingActive || isTranscribing}
                style={{
                  flex: 1,
                  background: selectedAudio === "jfk" ? "#3b82f6" : "#27272a",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "5px 4px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                English JFK
              </button>
              <button
                type="button"
                onClick={() => setSelectedAudio("hindi")}
                disabled={isRecordingActive || isTranscribing}
                style={{
                  flex: 1,
                  background: selectedAudio === "hindi" ? "#3b82f6" : "#27272a",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "5px 4px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Hindi OGG
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRecordingActive || isTranscribing}
                style={{
                  flex: 1,
                  background: selectedAudio === "custom" ? "#3b82f6" : "#27272a",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "5px 4px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                {customFileName ? "Custom" : "Upload"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={handleCustomFileChange}
              />
            </div>

            <button
              type="button"
              onClick={handleRunFixtureTranscription}
              disabled={isTranscribing || isRecordingActive || status !== "ready"}
              style={{
                background: isTranscribing ? "#71717a" : "#27272a",
                color: "#ffffff",
                border: "1px solid #3f3f46",
                borderRadius: "6px",
                padding: "7px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: status !== "ready" ? "not-allowed" : "pointer",
              }}
            >
              {isTranscribing ? "Transcribing..." : "▶ Transcribe Selected Fixture"}
            </button>
          </div>

          {/* Results Output Box */}
          {transcriptionResult && (
            <div
              style={{
                background: "#09090b",
                border: "1px solid #27272a",
                borderRadius: "8px",
                padding: "10px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#a1a1aa" }}>
                <span>Recognized Output:</span>
                <span>
                  ⏱️ {transcriptionResult.durationMs}ms ({transcriptionResult.device.toUpperCase()})
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "13px",
                  lineHeight: "1.4",
                  color: "#f4f4f5",
                  whiteSpace: "pre-wrap",
                }}
              >
                {transcriptionResult.text || "(Empty transcription)"}
              </p>
            </div>
          )}

          {/* Error Message Box */}
          {errorMessage && (
            <div
              style={{
                background: "#450a0a",
                border: "1px solid #7f1d1d",
                color: "#fca5a5",
                borderRadius: "8px",
                padding: "8px 10px",
                fontSize: "12px",
                lineHeight: "1.4",
              }}
            >
              <strong>Error:</strong> {errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
