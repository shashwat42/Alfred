import React, { useState, useRef, useEffect, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import {
  ArrowUp,
  Mic,
  MicOff,
  X,
  Sparkles,
  Loader2,
  AlertCircle,
  Square,
  ArrowLeftRight,
  Trash2,
} from "lucide-react";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of inactivity

/**
 * Dismisses the overlay window safely without terminating Alfred.
 */
async function dismissOverlayWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const win = getCurrentWebviewWindow();
      await win.hide();
    } catch (e) {
      console.warn("Failed to hide overlay window:", e);
    }
  }
}

/**
 * Positions the overlay window horizontally centered and near the top of the screen.
 */
async function positionOverlayAtTop(): Promise<void> {
  if (isTauri()) {
    try {
      const win = getCurrentWebviewWindow();
      const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      if (monitor) {
        const outerSize = await win.outerSize();
        const screenWidth = monitor.size.width;
        const screenX = monitor.position.x;
        const screenY = monitor.position.y;
        const targetX = screenX + Math.round((screenWidth - outerSize.width) / 2);
        const targetY = screenY + 8; // Anchored near very top of monitor
        await win.setPosition(new PhysicalPosition(targetX, targetY));
      }
    } catch (e) {
      console.warn("Failed to position overlay at top:", e);
    }
  }
}

/**
 * Standardized Mode-Switch Button
 * Identical icon, sizing, styling, and animations across Normal and Voice modes.
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
      title={isTargetingVoice ? "Switch to voice mode" : "Switch to normal mode"}
      aria-label={isTargetingVoice ? "Switch to voice mode" : "Switch to normal mode"}
      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center shrink-0"
    >
      <ArrowLeftRight size={15} />
    </button>
  );
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
  }, []);

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

      {isLoading && (
        <div className="flex items-center gap-2 self-start px-3.5 py-2 rounded-2xl bg-[#18181b] border border-white/12 text-xs text-red-400 font-medium shadow-sm">
          <Sparkles size={14} className="animate-pulse" />
          <span>{statusLabel}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-start gap-2 self-start px-3.5 py-2 rounded-2xl bg-red-950 border border-red-800 text-xs text-red-300 font-medium max-w-[90%] shadow-sm">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
          <span className="flex-1 leading-relaxed">{errorMessage}</span>
        </div>
      )}

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

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenSummon = await listen("alfred:overlay-summon", () => {
          ensureFocus();
        });
      } catch {
        // Fallback
      }
    };
    void setupListener();

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      if (unlistenSummon) unlistenSummon();
    };
  }, [ensureFocus]);

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
        const result = await sendChatMessage(context, abortController.signal);

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
      {/* 1. Stationary, Fixed-Position Control Bar */}
      <div className="w-full shrink-0 flex items-center gap-3 px-3.5 py-2.5 bg-[#121216]/95 backdrop-blur-md border border-white/12 rounded-2xl text-slate-100 transition-all z-20 shadow-xl">
        <img
          src={Logo}
          alt="Alfred"
          className="w-6 h-6 shrink-0 opacity-95 transition-opacity"
        />

        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => {
            onUserActivity();
            setPrompt(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            isLoading
              ? "Type follow-up prompt... (Enter to queue)"
              : "Ask Alfred anything... (Enter to send, Esc to close)"
          }
          className="flex-1 bg-transparent border-0 outline-none text-[14px] text-white placeholder-zinc-400 font-normal focus:ring-0 leading-tight"
          autoFocus
        />

        <div className="flex items-center gap-1.5 shrink-0">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              title="New / Clear Chat"
              aria-label="New / Clear Chat"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            >
              <Trash2 size={15} />
            </button>
          )}

          {/* Standardized Mode Switch Button */}
          <OverlayModeSwitchButton targetMode="voice" onClick={onSwitchMode} />

          {isLoading ? (
            <div className="p-1.5 text-red-400 animate-spin flex items-center justify-center">
              <Loader2 size={16} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!prompt.trim()}
              title="Submit prompt"
              aria-label="Submit prompt"
              className="p-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:hover:bg-red-600 text-white transition-all active:scale-95 flex items-center justify-center"
            >
              <ArrowUp size={15} />
            </button>
          )}

          <button
            type="button"
            onClick={onDismiss}
            title="Dismiss overlay (Esc)"
            aria-label="Dismiss overlay (Esc)"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <X size={15} />
          </button>
        </div>
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
}: {
  onDismiss: () => void;
  onSwitchMode: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onClearSession: () => void;
  onUserActivity: () => void;
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
    });
    return () => unsubLevel();
  }, []);

  // Hands-free Voice loop
  useEffect(() => {
    isListeningRef.current = true;
    const currentSession = ++sessionIdRef.current;

    async function runLoop() {
      try {
        setVoiceState("starting");

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
          const response = await sendChatMessage(context, controller.signal, { recording: recResult });
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
  }, [stopVoice, isMuted, setMessages, onUserActivity]);

  const scale =
    voiceState === "listening" && !isMuted
      ? 1 + Math.min(0.18, audioLevel * 0.35)
      : voiceState === "thinking"
      ? 1.05
      : 1;

  const glowColor =
    voiceState === "error"
      ? "rgba(239, 68, 68, 0.7)"
      : voiceState === "thinking"
      ? "rgba(220, 38, 38, 0.75)"
      : voiceState === "transcribing"
      ? "rgba(239, 68, 68, 0.7)"
      : isMuted
      ? "rgba(113, 113, 122, 0.4)"
      : `rgba(220, 38, 38, ${0.4 + Math.min(0.6, audioLevel * 0.6)})`;

  const isThinkingOrTranscribing = voiceState === "thinking" || voiceState === "transcribing";

  return (
    <div className="w-full max-w-155 flex flex-col font-sans select-none pointer-events-auto">
      {/* 1. Standardized Voice Control Bar */}
      <div className="w-full shrink-0 flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#121216]/95 backdrop-blur-md border border-white/12 rounded-2xl text-slate-100 transition-all z-20 shadow-xl">
        {/* Left Side: Status Pill & Mute Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-zinc-300">
            <span
              className={`w-2 h-2 rounded-full ${
                voiceState === "listening" && !isMuted
                  ? "bg-green-400 animate-ping"
                  : voiceState === "transcribing"
                  ? "bg-red-400 animate-pulse"
                  : voiceState === "thinking"
                  ? "bg-red-500 animate-pulse"
                  : voiceState === "error"
                  ? "bg-red-400"
                  : "bg-zinc-500"
              }`}
            />
            <span className="capitalize text-[11px] font-medium tracking-wide">
              {voiceState === "starting" && "Connecting..."}
              {voiceState === "listening" && (isMuted ? "Muted" : "Listening")}
              {voiceState === "transcribing" && "Preparing audio..."}
              {voiceState === "thinking" && "Thinking..."}
              {voiceState === "error" && "Error"}
            </span>
          </div>

          <button
            type="button"
            onClick={handleToggleMute}
            title={isMuted ? "Unmute microphone" : "Mute microphone"}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            className={`p-1.5 rounded-lg transition-all active:scale-95 ${
              isMuted
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "text-zinc-400 hover:text-white hover:bg-white/10"
            }`}
          >
            {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
        </div>

        {/* Center: Glowing Alfred Logo */}
        <div
          className="relative flex items-center justify-center transition-transform duration-100 ease-out"
          style={{
            transform: `scale(${scale})`,
            filter: `drop-shadow(0 0 ${10 + Math.round(audioLevel * 14)}px ${glowColor})`,
          }}
        >
          <img
            src={Logo}
            alt="Alfred"
            className={`w-6 h-6 transition-opacity ${
              voiceState === "thinking"
                ? "animate-pulse"
                : voiceState === "transcribing"
                ? "opacity-80"
                : "opacity-100"
            }`}
          />
        </div>

        {/* Right Side: Action Controls & Mode Switch */}
        <div className="flex items-center gap-1.5 shrink-0">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClearSession}
              title="New / Clear Chat"
              aria-label="New / Clear Chat"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            >
              <Trash2 size={15} />
            </button>
          )}

          {/* Standardized Mode Switch Button */}
          <OverlayModeSwitchButton targetMode="quick_input" onClick={onSwitchMode} />

          <button
            type="button"
            onClick={handleDismiss}
            title="Stop voice mode (Esc)"
            aria-label="Stop voice mode (Esc)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-xs active:scale-95 transition-all shadow-sm"
          >
            <Square size={11} fill="currentColor" />
            <span>Stop</span>
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            title="Dismiss overlay (Esc)"
            aria-label="Dismiss overlay (Esc)"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <X size={15} />
          </button>
        </div>
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
 * - 10-minute idle inactivity auto-reset
 * - Centered layout with seamless downward card expansion
 * - Automatic reset on overlay dismissal (Escape or Close)
 */
export default function OverlayApp() {
  const [mode, setMode] = useState<DesktopOverlayMode>(() => getSavedOverlayMode());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastActivityTimeRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastActivityTimeRef.current = Date.now();
  }, []);

  const resetSession = useCallback(() => {
    setMessages([]);
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
    let unlisten: (() => void) | undefined;
    const setupSummonListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("alfred:overlay-summon", () => {
          void positionOverlayAtTop();
          const now = Date.now();
          if (now - lastActivityTimeRef.current > IDLE_TIMEOUT_MS) {
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
    void positionOverlayAtTop();
    return () => {
      if (unlisten) unlisten();
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
    <div className="overlay-root w-screen h-screen flex flex-col items-center justify-start pt-2 px-4 pb-4 bg-transparent overflow-hidden pointer-events-none">
      {mode === "quick_input" ? (
        <QuickInputOverlay
          onDismiss={handleDismiss}
          onSwitchMode={handleSwitchMode}
          messages={messages}
          setMessages={setMessages}
          onClearSession={resetSession}
          onUserActivity={recordUserActivity}
        />
      ) : (
        <VoiceOverlay
          onDismiss={handleDismiss}
          onSwitchMode={handleSwitchMode}
          messages={messages}
          setMessages={setMessages}
          onClearSession={resetSession}
          onUserActivity={recordUserActivity}
        />
      )}
    </div>
  );
}
