import { ErrorNotice } from "../components/reliability/Notifications";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { positionOverlayAtTop } from "../lib/overlayWindow.ts";
import { isTauri } from "../auth/auth.ts";
import {
  type ChatMessage,
  boundVoiceResources,
  buildSafeChatContext,
  sendChatMessage,
} from "../lib/aiChat.ts";
import { audioRecorder } from "../lib/audioRecorder.ts";
import { VoiceNote } from "../components/VoiceNote.tsx";
import { getSilenceTimeout } from "../lib/voicePreferences.ts";
import { AudioRecorderError, type VoiceModeState } from "../types/audio.ts";
import {
  type DesktopOverlayMode,
  getSavedOverlayMode,
  setSavedOverlayMode,
  OVERLAY_MODE_CHANGED_EVENT,
} from "../lib/overlayMode.ts";
import Logo from "../assets/Alfred_Logo.svg";
import { SafeMarkdown } from "../components/SafeMarkdown.tsx";
import "./overlay.css";
import {
  SendHorizontal,
  AudioLines,
  Mic,
  MicOff,
  X,
  Sparkles,
  Loader2,
  Trash2,
} from "lucide-react";

const IDLE_TIMEOUT_MS = 60 * 1000; // One minute of inactivity

/**
 * Release the overlay renderer when explicitly dismissed. Its session is reset
 * by the caller; the main window and tray keep Alfred running.
 */
async function dismissOverlayWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const win = getCurrentWebviewWindow();
      await win.close();
    } catch (e) {
      console.warn("Failed to close overlay window:", e);
    }
  }
}

/**
 * Standardized Mode-Switch Button
 * Circular control matching the clear-chat button in both modes.
 */
export function OverlayModeSwitchButton({
  targetMode,
  onClick,
}: {
  targetMode: DesktopOverlayMode;
  onClick: () => void;
}) {
  const isTargetingVoice = targetMode === "voice";
  return (
    <button
      type="button"
      onClick={onClick}
      title={isTargetingVoice ? "Switch to voice mode" : "Switch to text mode"}
      aria-label={isTargetingVoice ? "Switch to voice mode" : "Switch to text mode"}
      className="desktop-overlay-circle"
    >
      {isTargetingVoice ? <AudioLines size={24} /> : <X size={32} />}
    </button>
  );
}

function ClearChatButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="desktop-overlay-circle" title="Clear chat" aria-label="Clear chat" onClick={onClick}><Trash2 size={22} /></button>;
}

/**
 * Unified Overlay Conversation List Component
 * Renders all user and assistant turns chronologically with identical bubble design,
 * typography, and smooth auto-scrolling across both modes.
 */
export function OverlayConversationList({
  messages,
  isLoading = false,
  statusLabel = "Alfred is thinking...",
  errorMessage = null,
  onUserActivity,
}: {
  messages: ChatMessage[];
  isLoading?: boolean;
  statusLabel?: string;
  errorMessage?: string | null;
  onUserActivity?: () => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);

  // Track user scroll position
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 80;
    onUserActivity?.();
  }, [onUserActivity]);

  // Auto-scroll when messages or status change if user was near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, statusLabel, errorMessage]);

  const hasContent = messages.length > 0 || isLoading || Boolean(errorMessage);
  if (!hasContent) return null;

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="w-full mt-3 max-h-125 overflow-y-auto pr-1 flex flex-col gap-3 py-1 select-text animate-fadeIn"
      onClick={() => onUserActivity?.()}
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex flex-col gap-1 text-[13.5px] leading-relaxed ${
            msg.role === "user" ? "items-end" : "items-start"
          }`}
        >
          <div
            className={`px-4 py-2.5 rounded-2xl max-w-[85%] font-normal shadow-sm ${
              msg.role === "user"
                ? "bg-[#27272a] text-white border border-red-500/25"
                : "bg-[#18181b] text-zinc-100 border border-white/12"
            }`}
          >
            {msg.role === "assistant" ? (
              <SafeMarkdown content={msg.content} />
            ) : (
              <span className="whitespace-pre-wrap">{msg.recording ? <VoiceNote recording={msg.recording} /> : msg.content}</span>
            )}
          </div>
        </div>
      ))}

      {isLoading && messages.length === 0 && (
        <div className="flex items-center gap-2 self-start px-3.5 py-2 rounded-2xl bg-[#18181b] border border-white/12 text-xs text-red-400 font-medium shadow-sm">
          <Sparkles size={14} className="animate-pulse" />
          <span>{statusLabel}</span>
        </div>
      )}

      <ErrorNotice message={errorMessage} />

      <div ref={conversationEndRef} />
    </div>
  );
}

/**
 * Normal Mode Component (Quick Input)
 * - Stationary, fixed-position control bar
 * - Multi-turn conversation context preserved in session
 * - Clear Chat / New Chat action
 * - Standardized unified mode-switch button
 */
export function QuickInputOverlay({
  onDismiss,
  onSwitchMode,
  messages,
  setMessages,
  onClearSession,
  onUserActivity,
}: {
  onDismiss: () => void;
  onSwitchMode: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onClearSession: () => void;
  onUserActivity: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const requestQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const ensureFocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    ensureFocus();
  }, [ensureFocus]);

  useEffect(() => {
    const handleWindowFocus = () => {
      ensureFocus();
    };

    window.addEventListener("focus", handleWindowFocus);
    let unlistenSummon: (() => void) | undefined;
    let disposed = false;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("alfred:overlay-summon", () => {
          if (!disposed) ensureFocus();
        });
        if (disposed) unlisten(); else unlistenSummon = unlisten;
      } catch {
        // Fallback
      }
    };
    void setupListener();

    return () => {
      disposed = true;
      window.removeEventListener("focus", handleWindowFocus);
      if (unlistenSummon) unlistenSummon();
    };
  }, [ensureFocus]);

  useEffect(() => () => {
    requestQueueRef.current = [];
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
  }, []);

  const processNextPrompt = useCallback(
    async (textToProcess: string) => {
      const trimmed = textToProcess.trim();
      if (!trimmed) return;

      onUserActivity();
      setIsLoading(true);
      setErrorMessage(null);

      const userMessage: ChatMessage = {
        id: `overlay-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      const updatedHistory = [...messagesRef.current, userMessage];
      setMessages(updatedHistory);
      messagesRef.current = updatedHistory;

      const abortController = new AbortController();
      activeAbortRef.current = abortController;

      try {
        const context = buildSafeChatContext(updatedHistory, trimmed);
        const result = await sendChatMessage(context, abortController.signal, { requestId: userMessage.id });

        if (activeAbortRef.current !== abortController) return;

        const assistantMessage: ChatMessage = {
          id: `overlay-asst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: "assistant",
          content: result.message.content,
          timestamp: Date.now(),
        };

        const withAssistant = [...messagesRef.current, assistantMessage];
        setMessages(withAssistant);
        messagesRef.current = withAssistant;

        if (
          result.actionsExecuted &&
          result.actionsExecuted.length > 0 &&
          typeof window !== "undefined"
        ) {
          window.dispatchEvent(
            new CustomEvent("alfred:action_executed", {
              detail: { actions: result.actionsExecuted },
            })
          );
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (activeAbortRef.current !== abortController) return;
        const msg = err instanceof Error ? err.message : "Request failed";
        setErrorMessage(msg);
      } finally {
        if (activeAbortRef.current === abortController) {
          activeAbortRef.current = null;
        }

        if (requestQueueRef.current.length > 0) {
          const nextPrompt = requestQueueRef.current.shift()!;
          void processNextPrompt(nextPrompt);
        } else {
          isProcessingQueueRef.current = false;
          setIsLoading(false);
          ensureFocus();
        }
      }
    },
    [onUserActivity, setMessages, ensureFocus]
  );

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setPrompt("");
    ensureFocus();

    if (isLoading || isProcessingQueueRef.current) {
      requestQueueRef.current.push(trimmed);
    } else {
      isProcessingQueueRef.current = true;
      void processNextPrompt(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onUserActivity();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
        activeAbortRef.current = null;
      }
      requestQueueRef.current = [];
      isProcessingQueueRef.current = false;
      onDismiss();
    }
  };

  const handleClear = () => {
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
      activeAbortRef.current = null;
    }
    requestQueueRef.current = [];
    isProcessingQueueRef.current = false;
    setIsLoading(false);
    setErrorMessage(null);
    setPrompt("");
    onClearSession();
    ensureFocus();
  };

  return (
    <div className="w-full max-w-155 flex flex-col font-sans select-none pointer-events-auto">
      <div className="desktop-overlay-dock">
        <ClearChatButton onClick={handleClear} />
        <form className="desktop-overlay-pill desktop-overlay-composer" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            aria-label="Ask Alfred"
            value={prompt}
            onChange={(event) => { onUserActivity(); setPrompt(event.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? "Ask a follow-up..." : "Ask Alfred"}
            title="Enter to send or queue a follow-up; Escape to close"
            autoFocus
          />
          {isLoading ? <span role="status" aria-label="Alfred is thinking" className="desktop-overlay-send"><Loader2 size={25} className="desktop-overlay-spinner" /></span> : <button type="submit" className="desktop-overlay-send" disabled={!prompt.trim()} title="Submit prompt" aria-label="Submit prompt"><SendHorizontal size={28} /></button>}
        </form>
        <OverlayModeSwitchButton targetMode="voice" onClick={onSwitchMode} />
      </div>

      {/* 2. Unified Conversation Display */}
      <OverlayConversationList
        messages={messages}
        isLoading={isLoading}
        statusLabel="Alfred is thinking..."
        errorMessage={errorMessage}
        onUserActivity={() => {
          onUserActivity();
          ensureFocus();
        }}
      />
    </div>
  );
}

/**
 * Voice Mode Component
 * - Standardized control bar dimensions, styling, and mode-switch button
 * - Preserves hands-free audio recording, transcription, and speech pipeline
 * - Displays complete multi-turn conversation chronologically
 */
export function VoiceOverlay({
  onDismiss,
  onSwitchMode,
  messages,
  setMessages,
  onClearSession,
  onUserActivity,
  sessionVersion = 0,
}: {
  onDismiss: () => void;
  onSwitchMode: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onClearSession: () => void;
  onUserActivity: () => void;
  sessionVersion?: number;
}) {
  const [voiceState, setVoiceState] = useState<VoiceModeState>("starting");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const voiceAbort = useRef<AbortController | null>(null);
  const isListeningRef = useRef(true);
  const sessionIdRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const stopVoice = useCallback(() => {
    isListeningRef.current = false;
    voiceAbort.current?.abort();
    audioRecorder.cancel();
  }, []);

  const handleDismiss = useCallback(() => {
    stopVoice();
    onDismiss();
  }, [stopVoice, onDismiss]);

  const handleToggleMute = () => {
    onUserActivity();
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        audioRecorder.cancel();
      }
      return next;
    });
  };

  // Handle global Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleDismiss]);

  // Audio level tracking
  useEffect(() => {
    const unsubLevel = audioRecorder.addLevelListener((level) => {
      setAudioLevel(level);
      if (level > 0.02) onUserActivity();
    });
    return () => unsubLevel();
  }, [onUserActivity]);

  // Hands-free Voice loop
  useEffect(() => {
    isListeningRef.current = true;
    const currentSession = ++sessionIdRef.current;

    async function runLoop() {
      try {
        setVoiceState("starting");
        setVoiceError(null);

      } catch (err: unknown) {
        if (!isListeningRef.current || sessionIdRef.current !== currentSession) return;
        const msg = err instanceof Error ? err.message : String(err);
        setVoiceError(msg);
        setVoiceState("error");
        return;
      }

      if (!isListeningRef.current || sessionIdRef.current !== currentSession) return;

      while (isListeningRef.current && sessionIdRef.current === currentSession) {
        if (isMuted) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }

        try {
          setVoiceState("listening");
          const recResult = await audioRecorder.recordTurn({
            enableSilenceDetection: true,
            silenceDurationMs: getSilenceTimeout(),
            maxDurationMs: 60000,
          });

          if (!isListeningRef.current || sessionIdRef.current !== currentSession) break;
          if (isMuted) continue;

          const text = "Voice message";
          onUserActivity();

          const userMessage: ChatMessage = {
            id: `overlay-voice-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "user",
            content: text,
            recording: recResult,
            timestamp: Date.now(),
          };

          const currentHistory = boundVoiceResources([...messagesRef.current, userMessage]);
          setMessages(currentHistory);
          messagesRef.current = currentHistory;

          setVoiceState("thinking");
          const context = buildSafeChatContext(currentHistory, text);
          const controller = new AbortController();
          voiceAbort.current = controller;
          const response = await sendChatMessage(context, controller.signal, { recording: recResult, requestId: userMessage.id });
          if (!isListeningRef.current || sessionIdRef.current !== currentSession) break;

          const assistantMessage: ChatMessage = {
            id: `overlay-voice-asst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "assistant",
            content: response.message.content,
            timestamp: Date.now(),
          };

          const withAssistant = [...currentHistory, assistantMessage];
          setMessages(withAssistant);
          messagesRef.current = withAssistant;

          if (
            response.actionsExecuted &&
            response.actionsExecuted.length > 0 &&
            typeof window !== "undefined"
          ) {
            window.dispatchEvent(
              new CustomEvent("alfred:action_executed", {
                detail: { actions: response.actionsExecuted },
              })
            );
          }

          if (!isListeningRef.current || sessionIdRef.current !== currentSession) break;

          await new Promise((resolve) => setTimeout(resolve, 600));
        } catch (err: unknown) {
          if (!isListeningRef.current || sessionIdRef.current !== currentSession) break;
          if (err instanceof AudioRecorderError && err.code === "EMPTY_AUDIO") {
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.toLowerCase().includes("cancel")) {
            continue;
          }
          setVoiceError(msg);
          setVoiceState("error");
          stopVoice();
          break;
        }
      }
    }

    void runLoop();

    return () => {
      stopVoice();
    };
  }, [stopVoice, isMuted, setMessages, onUserActivity, sessionVersion]);

  const isThinkingOrTranscribing = voiceState === "thinking" || voiceState === "transcribing";

  return (
    <div className="w-full max-w-155 flex flex-col font-sans select-none pointer-events-auto">
      <div className="desktop-overlay-dock">
        <ClearChatButton onClick={onClearSession} />
        <div className="desktop-overlay-pill desktop-overlay-voice">
          <span className={`desktop-overlay-logo state-${voiceState}${isMuted ? " is-muted" : ""}`}>
            <img src={Logo} alt="Alfred" />
          </span>
          <span className="desktop-overlay-activity" role="status" aria-label={isMuted ? "Microphone muted" : voiceState}>
            {!isMuted && (isThinkingOrTranscribing || voiceState === "starting") ? <Loader2 size={30} className="desktop-overlay-spinner" /> : <span className={`desktop-overlay-wave${voiceState === "listening" && !isMuted ? " is-recording" : ""}`} style={{ "--voice-level": voiceState === "listening" && !isMuted ? Math.min(1, audioLevel * 4) : 0 } as React.CSSProperties} aria-hidden="true">{[12, 25, 17, 34, 24, 40, 28, 18, 30, 14].map((height, index) => <i key={index} style={{ height, animationDelay: `${index * -0.09}s` }} />)}</span>}
          </span>
          <button type="button" className="desktop-overlay-mic" onClick={handleToggleMute} aria-pressed={!isMuted} title={isMuted ? "Unmute microphone" : "Mute microphone"} aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}>
            {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
          </button>
        </div>
        <OverlayModeSwitchButton targetMode="quick_input" onClick={onSwitchMode} />
      </div>

      {/* 2. Unified Conversation Display */}
      <OverlayConversationList
        messages={messages}
        isLoading={isThinkingOrTranscribing}
        statusLabel={voiceState === "transcribing" ? "Preparing audio..." : "Alfred is thinking..."}
        errorMessage={voiceError}
        onUserActivity={onUserActivity}
      />
    </div>
  );
}

/**
 * Main Overlay Application Entry Point
 * Manages:
 * - Shared, session-local in-memory chat history (persists across mode toggling)
 * - One-minute idle inactivity auto-reset
 * - Centered layout with seamless downward card expansion
 * - Automatic reset on overlay dismissal (Escape or Close)
 */
export default function OverlayApp() {
  const [mode, setMode] = useState<DesktopOverlayMode>(() => getSavedOverlayMode());
  const [sessionVersion, setSessionVersion] = useState(0);
  const [visible, setVisible] = useState(false);
  const [appearance, setAppearance] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastActivityTimeRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastActivityTimeRef.current = Date.now();
  }, []);

  const resetSession = useCallback(() => {
    setMessages([]);
    setSessionVersion((version) => version + 1);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    audioRecorder.cancel();
    lastActivityTimeRef.current = Date.now();
  }, []);

  const recordUserActivity = useCallback(() => {
    lastActivityTimeRef.current = Date.now();
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      resetSession();
    }, IDLE_TIMEOUT_MS);
  }, [resetSession]);

  useEffect(() => {
    recordUserActivity();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [recordUserActivity]);

  useEffect(() => {
    const handleModeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ mode: DesktopOverlayMode }>;
      if (customEvent.detail?.mode) {
        setMode(customEvent.detail.mode);
      } else {
        setMode(getSavedOverlayMode());
      }
    };

    window.addEventListener(OVERLAY_MODE_CHANGED_EVENT, handleModeChange);
    window.addEventListener("storage", handleModeChange);
    return () => {
      window.removeEventListener(OVERLAY_MODE_CHANGED_EVENT, handleModeChange);
      window.removeEventListener("storage", handleModeChange);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const visibilityChanged = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibilityChanged);
    const setupSummonListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const subscribe = async (name: string, handler: () => void) => {
          const unlisten = await listen(name, () => { if (!disposed) handler(); });
          if (disposed) unlisten(); else unlisteners.push(unlisten);
        };
        await subscribe("alfred:overlay-hidden", () => setVisible(false));
        await subscribe("alfred:overlay-summon", () => {
          void positionOverlayAtTop().then(() => { if (!disposed) { setVisible(true); setAppearance(value => value + 1); } });
          const now = Date.now();
          if (now - lastActivityTimeRef.current >= IDLE_TIMEOUT_MS) {
            resetSession();
          } else {
            recordUserActivity();
          }
        });
      } catch {
        // Fallback
      }
    };
    void setupSummonListener();
    void positionOverlayAtTop().then(async () => {
      if (disposed) return;
      setVisible(true);
    });
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibilityChanged);
      unlisteners.forEach(unlisten => unlisten());
    };
  }, [resetSession, recordUserActivity]);

  const handleDismiss = useCallback(() => {
    resetSession();
    void dismissOverlayWindow();
  }, [resetSession]);

  const handleSwitchMode = useCallback(() => {
    recordUserActivity();
    const nextMode = mode === "quick_input" ? "voice" : "quick_input";
    setMode(nextMode);
    setSavedOverlayMode(nextMode);
  }, [mode, recordUserActivity]);

  return (
    <div key={appearance} style={{ visibility: visible ? "visible" : "hidden" }} className="overlay-root w-screen h-screen flex flex-col items-center justify-start pt-2 px-4 pb-4 bg-transparent overflow-hidden pointer-events-none">
      {mode === "quick_input" ? (
        <QuickInputOverlay
          key={sessionVersion}
          onDismiss={handleDismiss}
          onSwitchMode={handleSwitchMode}
          messages={messages}
          setMessages={setMessages}
          onClearSession={resetSession}
          onUserActivity={recordUserActivity}
        />
      ) : visible ? (
        <VoiceOverlay
          sessionVersion={sessionVersion}
          onDismiss={handleDismiss}
          onSwitchMode={handleSwitchMode}
          messages={messages}
          setMessages={setMessages}
          onClearSession={resetSession}
          onUserActivity={recordUserActivity}
        />
      ) : null}
    </div>
  );
}
