import { useAccountProfile } from "../hooks/useAccountProfile.ts";
import { RefreshButton } from "./RefreshButton.tsx";
import { ErrorNotice } from "./reliability/Notifications";
import { useState, useRef, useEffect, useCallback } from "react";
import { StateControl } from "./reliability/StateControl";
import Logo from "../assets/Alfred_Logo.svg";
import { useAuth } from "../auth/authContext.ts";
import { PanelLeftClose, PanelLeftOpen, Plus, Radio, Mic, MicOff, X } from "lucide-react";
import {
  type ChatMessage,
  boundVoiceResources,
  buildSafeChatContext,
  sendChatMessage,
} from "../lib/aiChat.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { audioRecorder } from "../lib/audioRecorder.ts";
import { VoiceNote } from "./VoiceNote.tsx";
import type { RecordingResult } from "../types/audio.ts";
import { getSilenceTimeout } from "../lib/voicePreferences.ts";
import { AudioRecorderError, type VoiceModeState } from "../types/audio.ts";

export interface VoiceHeaderState {
  voiceModeState: VoiceModeState;
  modelLoadingText: string;
  voiceModeError: string | null;
  voiceModeAudioLevel: number;
  isVoiceMuted: boolean;
  isAnimatingIn?: boolean;
  isLogoCentered: boolean;
  onRetry: () => void;
}

export interface ChatProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onNewChat?: () => void;
  isActiveView?: boolean;
  onVoiceStateChange?: (state: VoiceHeaderState) => void;
  onOpenSettings?: () => void;
}

function VoiceSpinner({ size = 15 }: { size?: number }) {
  return (
    <svg
      className="chat-voice-spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export function VoiceModeHeaderIndicator({
  voiceModeState,
  modelLoadingText,
  voiceModeError,
  voiceModeAudioLevel,
  isMuted,
  isAnimatingIn = false,
  onRetry,
}: {
  voiceModeState: VoiceModeState;
  modelLoadingText: string;
  voiceModeError: string | null;
  voiceModeAudioLevel: number;
  isMuted: boolean;
  isAnimatingIn?: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={`chat-voice-header-indicator state-${voiceModeState} ${isMuted ? "muted" : ""} ${isAnimatingIn ? "fade-in" : ""}`}
      style={{
        transform:
          voiceModeState === "listening" && !isMuted
            ? `scale(${1 + Math.min(0.06, voiceModeAudioLevel * 0.2)})`
            : undefined,
        boxShadow:
          voiceModeState === "listening" && !isMuted
            ? `0 0 ${14 + Math.round(voiceModeAudioLevel * 18)}px rgba(239, 68, 68, ${0.5 + Math.min(0.5, voiceModeAudioLevel * 0.5)})`
            : undefined,
      }}
      role="status"
      aria-live="polite"
    >
      <ErrorNotice message={voiceModeState === "error" ? voiceModeError || "Voice connection failed." : null} retry={onRetry} title="Voice unavailable" />
      <div className="chat-voice-header-logo-wrap" aria-hidden="true">
        <img src={Logo} alt="Alfred Voice Indicator" className="chat-voice-header-logo" />
        {voiceModeState === "starting" && (
          <div className="chat-voice-header-spinner">
            <VoiceSpinner size={14} />
          </div>
        )}
      </div>

      <div className="chat-voice-header-text">
        <span className="chat-voice-header-title">
          {voiceModeState === "starting" && "Initializing…"}
          {voiceModeState === "listening" && (isMuted ? "Microphone Muted" : "Listening…")}
          {voiceModeState === "transcribing" && "Preparing audio…"}
          {voiceModeState === "thinking" && "Alfred is thinking…"}
          {voiceModeState === "error" && "Voice paused"}
        </span>
        <span className="chat-voice-header-sub">
          {voiceModeState === "starting" && modelLoadingText}
          {voiceModeState === "listening" && (isMuted ? "Tap mic to unmute" : "Speak when ready")}
          {voiceModeState === "transcribing" && "Preparing recording"}
          {voiceModeState === "thinking" && "Generating answer…"}
          {voiceModeState === "error" && "Try again when ready"}
        </span>
      </div>


    </div>
  );
}

function VoiceModeHeroIndicator({
  voiceModeState,
  modelLoadingText,
  voiceModeError,
  voiceModeAudioLevel,
  isMuted,
  isAnimatingToHeader,
  onRetry,
}: {
  voiceModeState: VoiceModeState;
  modelLoadingText: string;
  voiceModeError: string | null;
  voiceModeAudioLevel: number;
  isMuted: boolean;
  isAnimatingToHeader: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={`chat-voice-hero-container ${isAnimatingToHeader ? "animating-to-header" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`chat-voice-hero-orb-wrap state-${voiceModeState} ${isMuted ? "muted" : ""}`}
        style={{
          transform:
            voiceModeState === "listening" && !isMuted
              ? `scale(${1 + Math.min(0.18, voiceModeAudioLevel * 0.45)})`
              : undefined,
          boxShadow:
            voiceModeState === "listening" && !isMuted
              ? `0 0 ${20 + Math.round(voiceModeAudioLevel * 24)}px rgba(239, 68, 68, ${0.5 + Math.min(0.5, voiceModeAudioLevel * 0.5)})`
              : undefined,
        }}
        aria-hidden="true"
      >
        <img src={Logo} alt="Alfred Voice Indicator" className="chat-voice-hero-logo" />
        {voiceModeState === "starting" && (
          <div className="chat-voice-hero-spinner">
            <VoiceSpinner size={32} />
          </div>
        )}
        {voiceModeState === "transcribing" && (
          <div className="chat-voice-transcribe-ring" />
        )}
      </div>

      <ErrorNotice message={voiceModeState === "error" ? voiceModeError || "Voice connection failed." : null} retry={onRetry} title="Voice unavailable" />
      <div className="chat-voice-hero-text">
        <h2 className="chat-voice-hero-title">
          {voiceModeState === "starting" && "Initializing…"}
          {voiceModeState === "listening" && (isMuted ? "Microphone Muted" : "Listening…")}
          {voiceModeState === "transcribing" && "Preparing audio…"}
          {voiceModeState === "thinking" && "Alfred is thinking…"}
          {voiceModeState === "error" && "Voice paused"}
        </h2>
        <p className="chat-voice-hero-sub">
          {voiceModeState === "starting" && modelLoadingText}
          {voiceModeState === "listening" && (isMuted ? "Tap mic to unmute" : "Speak when ready")}
          {voiceModeState === "transcribing" && "Preparing recording"}
          {voiceModeState === "thinking" && "Generating answer…"}
          {voiceModeState === "error" && "Try again when ready"}
        </p>
      </div>


    </div>
  );
}

function adjustTextareaHeight(el: HTMLTextAreaElement | null) {
  if (!el || el.clientWidth === 0) return;
  el.style.height = "auto";
  // An empty composer stays one line, even if its placeholder wraps while
  // the sidebar is narrow during the collapse/expand animation.
  if (el.value) el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

export default function Chat({
  isCollapsed = false,
  onToggleCollapse,
  onNewChat,
  isActiveView = true,
  onVoiceStateChange,
  onOpenSettings,
}: ChatProps) {
  const { session, loginWithGoogle } = useAuth();
  const [signInError, setSignInError] = useState("");
  const isGoogleUser = session?.account?.type === "user";
  const profile = useAccountProfile(session);
  const displayName = profile.name;

  // In-memory conversation state (ephemeral; cleared on reload)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleSendMessageRef = useRef<(textToSend?: string, voiceSessionId?: number, recording?: RecordingResult) => Promise<boolean>>(() => Promise.resolve(false));
  const [inputPrompt, setInputPrompt] = useState("");
  const pendingRecordingRef = useRef<RecordingResult | undefined>(undefined);
  const [pendingRecording, setPendingRecordingState] = useState<RecordingResult | undefined>(undefined);
  const setPendingRecording = useCallback((recording: RecordingResult | undefined) => {
    pendingRecordingRef.current = recording;
    setPendingRecordingState(recording);
  }, []);
  const hasComposerContent = Boolean(pendingRecording || inputPrompt.trim());
  const sendingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);

  // Push-to-talk voice recording state
  const [isRecordingPushToTalk, setIsRecordingPushToTalk] = useState(false);
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);

  // Persistent Hands-Free Voice Mode state
  const [voiceModeState, setVoiceModeState] = useState<VoiceModeState>("off");
  const [voiceModeError, setVoiceModeError] = useState<string | null>(null);
  const [voiceModeAudioLevel, setVoiceModeAudioLevel] = useState(0);
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const isVoiceMutedRef = useRef(false);
  useEffect(() => {
    isVoiceMutedRef.current = isVoiceMuted;
  }, [isVoiceMuted]);

  const [isLogoCentered, setIsLogoCentered] = useState(false);
  const [isLogoAnimatingToHeader, setIsLogoAnimatingToHeader] = useState(false);
  const isLogoCenteredRef = useRef(false);
  useEffect(() => {
    isLogoCenteredRef.current = isLogoCentered;
  }, [isLogoCentered]);

  const voiceModeActiveRef = useRef(false);
  const voiceSessionIdRef = useRef(0);
  const currentAbortControllerRef = useRef<AbortController | null>(null);

  const activeRequestIdRef = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaResizeObserverRef = useRef<ResizeObserver | null>(null);
  const bindTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    textareaResizeObserverRef.current?.disconnect();
    textareaResizeObserverRef.current = null;
    textareaRef.current = el;
    if (!el) return;
    adjustTextareaHeight(el);
    let previousWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      adjustTextareaHeight(el);
    });
    observer.observe(el);
    textareaResizeObserverRef.current = observer;
  }, []);
  const isNearBottomRef = useRef(true);
  const justSentMessageRef = useRef(false);

  const hasMessages = messages.length > 0 || isLoading;

  // Exit & clean up Voice Mode completely
  const handleExitVoiceMode = useCallback(() => {
    voiceSessionIdRef.current++;
    voiceModeActiveRef.current = false;
    setIsVoiceMuted(false);
    setIsLogoCentered(false);
    setIsLogoAnimatingToHeader(false);
    audioRecorder.cancel();
    if (currentAbortControllerRef.current) {
      try {
        currentAbortControllerRef.current.abort();
      } catch {
        // ignore
      }
      currentAbortControllerRef.current = null;
    }
    setVoiceModeState("off");
    setVoiceModeError(null);
  }, []);

  // Audio level, model progress, and unmount lifecycle management
  useEffect(() => {
    const stopForSystemAssistant = () => {
      handleExitVoiceMode();
      setIsRecordingPushToTalk(false);
      setIsTranscribingAudio(false);
    };
    window.addEventListener("alfred:android_assistant_opened", stopForSystemAssistant);
    return () => window.removeEventListener("alfred:android_assistant_opened", stopForSystemAssistant);
  }, [handleExitVoiceMode]);

  const modelLoadingText = "Preparing microphone…";

  useEffect(() => {
    const unsubLevel = audioRecorder.addLevelListener((level) => {
      setVoiceModeAudioLevel(level);
    });

    const sessionIdRef = voiceSessionIdRef;
    const modeActiveRef = voiceModeActiveRef;
    const abortCtrlRef = currentAbortControllerRef;

    return () => {
      unsubLevel();
      sessionIdRef.current++;
      modeActiveRef.current = false;
      audioRecorder.cancel();
      if (abortCtrlRef.current) {
        abortCtrlRef.current.abort();
        abortCtrlRef.current = null;
      }
    };
  }, []);

  // Terminate active voice recording if sidebar is collapsed or view becomes inactive
  useEffect(() => {
    if (isCollapsed || !isActiveView) {
      if (voiceModeActiveRef.current) {
        queueMicrotask(() => {
          handleExitVoiceMode();
        });
      }
      if (isRecordingPushToTalk) {
        audioRecorder.cancel();
        queueMicrotask(() => {
          setIsRecordingPushToTalk(false);
        });
      }
    }
  }, [isCollapsed, isActiveView, isRecordingPushToTalk, handleExitVoiceMode]);

  // Auto-scroll messages container strictly within sidebar when at bottom or upon sending
  useEffect(() => {
    if (!messagesContainerRef.current || !hasMessages) return;
    const shouldScroll = justSentMessageRef.current || isNearBottomRef.current;
    if (shouldScroll) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
      justSentMessageRef.current = false;
    }
  }, [messages, isLoading, hasMessages]);

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const threshold = 80;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= threshold;
  };

  // Adjust textarea height dynamically up to 120px
  useEffect(() => {
    adjustTextareaHeight(textareaRef.current);
  }, [inputPrompt]);

  const handleSendMessage = async (textToSend?: string, voiceSessionId?: number, recording?: RecordingResult): Promise<boolean> => {
    if (sendingRef.current) return false;

    const rawText = textToSend !== undefined ? textToSend : inputPrompt;
    recording ??= pendingRecordingRef.current ?? (failedPrompt === rawText.trim() ? messagesRef.current.at(-1)?.recording : undefined);
    const trimmed = rawText.trim() || (recording ? "Voice message" : "");
    if (!trimmed) return false;

    sendingRef.current = true;
    setPendingRecording(undefined);
    const currentReqId = ++activeRequestIdRef.current;
    const isRetry = textToSend !== undefined && failedPrompt === trimmed && messagesRef.current.at(-1)?.recording === recording;
    justSentMessageRef.current = true;

    if (isRetry) {
      const updated = messagesRef.current.map((m, idx) => {
        if (idx === messagesRef.current.length - 1 && m.role === "user" && m.error) {
          return { ...m, error: undefined };
        }
        return m;
      });
      messagesRef.current = updated;
      setMessages(updated);
    } else {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        content: trimmed,
        recording,
        timestamp: Date.now(),
      };
      const updated = boundVoiceResources([...messagesRef.current, userMessage]);
      messagesRef.current = updated;
      setMessages(updated);
    }

    setInputPrompt("");
    setFailedPrompt(null);
    setIsLoading(true);

    const abortController = new AbortController();
    currentAbortControllerRef.current = abortController;

    try {
      const context = buildSafeChatContext(messagesRef.current, trimmed);

      const response = await sendChatMessage(context, abortController.signal, { recording, requestId: messagesRef.current.at(-1)?.id });

      // Check if user reset chat or cancelled voice session while waiting
      if (activeRequestIdRef.current !== currentReqId) return false;
      if (voiceSessionId !== undefined && voiceSessionIdRef.current !== voiceSessionId) return false;

      // Dispatch confirmed actions so Dashboard synchronizes immediately
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

      const assistantMessage: ChatMessage = {
        id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "assistant",
        content: response.message.content,
        timestamp: Date.now(),
      };

      const updatedWithAsst = [...messagesRef.current, assistantMessage];
      messagesRef.current = updatedWithAsst;
      setMessages(updatedWithAsst);

      // If voice mode started in empty state, animate centered logo into header upon first completed AI response
      if (voiceModeActiveRef.current && isLogoCenteredRef.current) {
        const prefersReducedMotion =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (prefersReducedMotion) {
          setIsLogoCentered(false);
          setIsLogoAnimatingToHeader(false);
        } else {
          setIsLogoAnimatingToHeader(true);
          setTimeout(() => {
            setIsLogoCentered(false);
            setTimeout(() => {
              setIsLogoAnimatingToHeader(false);
            }, 400);
          }, 400);
        }
      }

      return true;
    } catch (err: unknown) {
      if (activeRequestIdRef.current !== currentReqId) return false;
      if (voiceSessionId !== undefined && voiceSessionIdRef.current !== voiceSessionId) return false;

      const isAbort =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");

      if (isAbort) {
        console.info("[Chat] AI request aborted by user.");
        return false;
      }

      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to receive a response from Alfred.";

      // Mark error on user message and preserve prompt for retry
      const updatedWithError = messagesRef.current.map((m, idx) => {
        if (idx === messagesRef.current.length - 1 && m.role === "user") {
          return { ...m, error: errorMessage };
        }
        return m;
      });
      messagesRef.current = updatedWithError;
      setMessages(updatedWithError);
      setFailedPrompt(trimmed);
      return false;
    } finally {
      if (currentAbortControllerRef.current === abortController) {
        currentAbortControllerRef.current = null;
      }
      if (activeRequestIdRef.current === currentReqId) {
        sendingRef.current = false;
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  });

  // Push-to-talk stages the finalized recording until the existing Send action.
  const handleTogglePushToTalk = async () => {
    if (voiceModeActiveRef.current) {
      handleExitVoiceMode();
    }

    if (isRecordingPushToTalk) {
      setIsTranscribingAudio(true);
      setIsRecordingPushToTalk(false);
      try { await audioRecorder.stop(); } catch { /* The capture promise below reports errors. */ }
    } else {
      try {
        setIsRecordingPushToTalk(true);
        const captureSession = voiceSessionIdRef.current;
        const result = await audioRecorder.record({ maxDurationMs: 60000 });
        if (captureSession !== voiceSessionIdRef.current) return;
        setPendingRecording(result);
        setInputPrompt("");
      } catch (err: unknown) {
        setIsRecordingPushToTalk(false);
        setVoiceModeError(err instanceof Error ? err.message : "Recording failed.");
      } finally {
        setIsRecordingPushToTalk(false);
        setIsTranscribingAudio(false);
      }
    }
  };



  // Persistent Hands-Free Voice Mode Loop
  const runVoiceModeLoop = async (sessionId: number, retryText?: string) => {
    setVoiceModeState("starting");
    if (!voiceModeActiveRef.current || voiceSessionIdRef.current !== sessionId) return;

    // 2. Hands-free turn loop
    let nextText = retryText;
    while (voiceModeActiveRef.current && voiceSessionIdRef.current === sessionId) {
      if (isVoiceMutedRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      try {
        let recording: RecordingResult | undefined = nextText ? messagesRef.current.at(-1)?.recording : undefined;
        let recognizedText = nextText;
        nextText = undefined;
        if (!recognizedText) {
          setVoiceModeState("listening");
          const recResult = await audioRecorder.recordTurn({
          enableSilenceDetection: true,
          silenceDurationMs: getSilenceTimeout(),
          maxDurationMs: 60000,
        });

        if (!voiceModeActiveRef.current || voiceSessionIdRef.current !== sessionId) break;
        if (isVoiceMutedRef.current) continue;

          recording = recResult;
          recognizedText = "Voice message";
        }
        if (!recognizedText) {
          continue; // Silence or non-speech, keep listening
        }

        setVoiceModeState("thinking");
        const success = await handleSendMessageRef.current(recognizedText, sessionId, recording);

        if (!voiceModeActiveRef.current || voiceSessionIdRef.current !== sessionId) break;

        if (!success) {
          throw new Error(messagesRef.current.at(-1)?.error || "Alfred couldn't generate a response. Please retry.");
        } else {
          // Natural pause before resuming listening for next user turn
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      } catch (err: unknown) {
        if (!voiceModeActiveRef.current || voiceSessionIdRef.current !== sessionId) break;
        if (err instanceof AudioRecorderError && err.code === "EMPTY_AUDIO") {
          continue;
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.toLowerCase().includes("cancel")) {
          // Interrupted by mute or typed message; loop continues safely without ending session
          continue;
        }
        setVoiceModeError(errorMsg);
        setVoiceModeState("error");
        voiceModeActiveRef.current = false;
        audioRecorder.cancel();
        break;
      }
    }
  };

  const handleToggleVoiceMute = () => {
    setIsVoiceMuted((prev) => {
      const next = !prev;
      isVoiceMutedRef.current = next;
      if (next) {
        audioRecorder.cancel();
      }
      return next;
    });
  };

  const handleSendVoiceModeText = async () => {
    if (!hasComposerContent || isLoading) return;
    const textToSend = inputPrompt;
    setInputPrompt("");
    audioRecorder.cancel();
    if (voiceModeActiveRef.current) {
      setVoiceModeState("thinking");
    }
    const currentSessionId = voiceSessionIdRef.current;
    await handleSendMessageRef.current(textToSend, currentSessionId);
    if (
      voiceModeActiveRef.current &&
      voiceSessionIdRef.current === currentSessionId &&
      voiceModeState !== "off"
    ) {
      setVoiceModeState("listening");
    }
  };

  const handleToggleVoiceMode = useCallback(async () => {
    if (voiceModeActiveRef.current) {
      handleExitVoiceMode();
    } else {
      if (isRecordingPushToTalk) {
        audioRecorder.cancel();
        setIsRecordingPushToTalk(false);
      }
      setVoiceModeError(null);
      voiceModeActiveRef.current = true;
      const newSessionId = ++voiceSessionIdRef.current;
      const startingEmpty = messagesRef.current.length === 0;
      setIsLogoCentered(startingEmpty);
      setIsLogoAnimatingToHeader(false);
      setVoiceModeState("starting");
      void runVoiceModeLoop(newSessionId);
    }
  }, [handleExitVoiceMode, isRecordingPushToTalk]);

  const handleRetryVoiceMode = useCallback(() => {
    setVoiceModeError(null);
    voiceModeActiveRef.current = true;
    const newSessionId = ++voiceSessionIdRef.current;
    setVoiceModeState("starting");
    const last = messagesRef.current.at(-1);
    void runVoiceModeLoop(newSessionId, last?.role === "user" && last.error ? last.content : undefined);
  }, []);

  useEffect(() => {
    if (onVoiceStateChange) {
      onVoiceStateChange({
        voiceModeState,
        modelLoadingText,
        voiceModeError,
        voiceModeAudioLevel,
        isVoiceMuted,
        isAnimatingIn: isLogoAnimatingToHeader,
        isLogoCentered,
        onRetry: handleRetryVoiceMode,
      });
    }
  }, [
    voiceModeState,
    modelLoadingText,
    voiceModeError,
    voiceModeAudioLevel,
    isVoiceMuted,
    isLogoAnimatingToHeader,
    isLogoCentered,
    handleRetryVoiceMode,
    handleToggleVoiceMode,
    onVoiceStateChange,
  ]);

  const handleRetry = () => {
    if (!failedPrompt || isLoading) return;
    void handleSendMessageRef.current(failedPrompt);
  };

  const handleNewChat = () => {
    if (voiceModeActiveRef.current) {
      handleExitVoiceMode();
    }
    if (isRecordingPushToTalk) {
      audioRecorder.cancel();
      setIsRecordingPushToTalk(false);
    }
    activeRequestIdRef.current++;
    setIsLogoCentered(false);
    setIsLogoAnimatingToHeader(false);
    voiceSessionIdRef.current++;
    setPendingRecording(undefined);
    sendingRef.current = false;
    currentAbortControllerRef.current?.abort();
    messagesRef.current = [];
    setMessages([]);
    setIsLoading(false);
    setFailedPrompt(null);
    setInputPrompt("");
    isNearBottomRef.current = true;
    justSentMessageRef.current = false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "Enter" || e.keyCode === 13 || e.which === 13) && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (hasComposerContent && !isLoading) {
        void handleSendMessage();
      }
    }
  };

  const handleVoiceKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "Enter" || e.keyCode === 13 || e.which === 13) && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (hasComposerContent && !isLoading) {
        void handleSendVoiceModeText();
      }
    }
  };

  return (
    <section className={`Chat ${isCollapsed ? "is-collapsed" : ""} ${hasMessages ? "has-active-conversation" : ""}`}>
      <ErrorNotice message={signInError} title="Google sign-in could not start" />
      {/* Top Sidebar Header: Controls & Alfred Branding */}
      <RefreshButton />
      <div className="chat-top-header">
        <div className="chat-actions-group">
          {onToggleCollapse && (
            <div className="chat-action-btn-wrapper chat-sidebar-collapse-wrapper">
              <button
                type="button"
                className="chat-action-btn chat-sidebar-toggle-btn"
                onClick={onToggleCollapse}
                aria-label={isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
                title={isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
              >
                {isCollapsed ? (
                  <PanelLeftOpen size={17} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <PanelLeftClose size={17} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
              <div className="chat-btn-tooltip" role="tooltip">
                {isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
              </div>
            </div>
          )}

          <StateControl />

          {hasMessages && (
            <>
              <div className="chat-action-btn-wrapper">
                <button
                  type="button"
                  className="chat-action-btn chat-new-conversation-btn"
                  onClick={() => {
                    if (onNewChat) {
                      onNewChat();
                    } else {
                      handleNewChat();
                    }
                  }}
                  aria-label="New chat"
                  title="New chat"
                >
                  <Plus size={17} strokeWidth={2} aria-hidden="true" />
                </button>
                <div className="chat-btn-tooltip" role="tooltip">
                  New chat
                </div>
              </div>

              <div className="chat-action-btn-wrapper">
                <button
                  type="button"
                  className={`chat-action-btn chat-voice-mode-action-btn ${voiceModeState !== "off" ? "active" : ""}`}
                  onClick={handleToggleVoiceMode}
                  disabled={isLoading || isRecordingPushToTalk}
                  aria-label={voiceModeState !== "off" ? "Stop Voice Mode" : "Voice Mode"}
                  title={voiceModeState !== "off" ? "Stop Voice Mode" : "Voice Mode"}
                >
                  {voiceModeState === "starting" ? (
                    <VoiceSpinner size={16} />
                  ) : (
                    <Radio size={17} strokeWidth={2} />
                  )}
                </button>
                <div className="chat-btn-tooltip" role="tooltip">
                  {voiceModeState !== "off" ? "Stop Voice Mode" : "Voice Mode"}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="chat-top-brand-title-wrap">
          {voiceModeState !== "off" && !isLogoCentered ? (
            <VoiceModeHeaderIndicator
              voiceModeState={voiceModeState}
              modelLoadingText={modelLoadingText}
              voiceModeError={voiceModeError}
              voiceModeAudioLevel={voiceModeAudioLevel}
              isMuted={isVoiceMuted}
              isAnimatingIn={isLogoAnimatingToHeader}
              onRetry={handleRetryVoiceMode}
            />
          ) : (
            <div className="chat-brand-normal-wrap">
              <img src={Logo} alt="Alfred Logo" className="chat-brand-logo" />
              <h1 className="chat-brand-title">ALFRED</h1>
            </div>
          )}
        </div>

        {/* Symmetry spacer to balance action buttons in expanded view */}
        <div className="chat-header-spacer" aria-hidden="true" />
      </div>

      {/* Main Sidebar Content Area (Hidden via CSS when collapsed, preserving conversation state) */}
      <div className="chat-body-content">
        {voiceModeState !== "off" && isLogoCentered ? (
          <div className="chat-main-content">
            <VoiceModeHeroIndicator
              voiceModeState={voiceModeState}
              modelLoadingText={modelLoadingText}
              voiceModeError={voiceModeError}
              voiceModeAudioLevel={voiceModeAudioLevel}
              isMuted={isVoiceMuted}
              isAnimatingToHeader={isLogoAnimatingToHeader}
              onRetry={handleRetryVoiceMode}
            />
            <div className="chat-active-composer" style={{ marginTop: "auto", width: "100%" }}>
              <div className="chat-composer-voice-row">
                <form
                  className="chat-prompt-input-wrapper"
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (hasComposerContent && !isLoading) {
                      void handleSendVoiceModeText();
                    }
                  }}
                >
                  {pendingRecording ? (
                    <div className="chat-pending-recording">
                      <VoiceNote recording={pendingRecording} />
                      <button type="button" className="chat-composer-btn" aria-label="Discard recording" title="Discard recording" onClick={() => setPendingRecording(undefined)}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                  <textarea
                    ref={bindTextarea}
                    rows={1}
                    className="chat-prompt-input"
                    aria-label="Ask Alfred while in Voice Mode"
                    placeholder="Ask Alfred..."
                    value={inputPrompt}
                    onChange={(e) => {
                      setPendingRecording(undefined);
                      setInputPrompt(e.target.value);
                      if (voiceModeActiveRef.current && voiceModeState === "listening") {
                        audioRecorder.cancel();
                      }
                    }}
                    onKeyDown={handleVoiceKeyDown}
                    enterKeyHint="send"
                    disabled={isLoading}
                  />
                  )}
                  <button
                    type="button"
                    className={`chat-composer-btn ${isRecordingPushToTalk ? "recording" : ""}`}
                    title={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                    aria-label={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                    disabled={isLoading || isTranscribingAudio}
                    onClick={handleTogglePushToTalk}
                  >
                    <Mic size={16} strokeWidth={2} />
                  </button>
                  <button
                    type="submit"
                    className="chat-prompt-send-btn"
                    disabled={isLoading || !hasComposerContent}
                    title="Send message"
                    aria-label={isLoading ? "Alfred is thinking" : "Send message"} aria-busy={isLoading}
                  >
                    {isLoading ? <VoiceSpinner size={14} /> : <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>}
                  </button>
                </form>

                <button
                  type="button"
                  className={`chat-voice-mute-btn ${isVoiceMuted ? "muted" : ""}`}
                  onClick={handleToggleVoiceMute}
                  aria-label={isVoiceMuted ? "Unmute microphone" : "Mute microphone"}
                  title={isVoiceMuted ? "Unmute microphone" : "Mute microphone"}
                >
                  {isVoiceMuted ? (
                    <MicOff size={18} strokeWidth={2.2} />
                  ) : (
                    <Mic size={18} strokeWidth={2.2} />
                  )}
                </button>

                <button
                  type="button"
                  className="chat-voice-close-btn"
                  onClick={handleExitVoiceMode}
                  aria-label="Exit Voice Mode"
                  title="Exit Voice Mode"
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>
        ) : !hasMessages ? (
          <div className="chat-main-content">
            <button
              type="button"
              className={`chat-mic-circle-btn ${voiceModeState !== "off" ? "recording" : ""}`}
              aria-label="Start Voice Mode"
              title="Start Voice Mode"
              onClick={handleToggleVoiceMode}
              disabled={isLoading || isTranscribingAudio}
            >
              <Radio size={48} strokeWidth={2.2} color="#141212" />
            </button>
            <p className="chat-prompt-label">
              {isRecordingPushToTalk
                ? "Listening... click mic when done"
                : isTranscribingAudio
                ? "Preparing audio..."
                : "Ask anything / Schedule a meeting!"}
            </p>
            <form
              className="chat-prompt-input-wrapper"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (hasComposerContent && !isLoading) {
                  void handleSendMessage();
                }
              }}
            >
              {pendingRecording ? (
                <div className="chat-pending-recording">
                  <VoiceNote recording={pendingRecording} />
                  <button type="button" className="chat-composer-btn" aria-label="Discard recording" title="Discard recording" onClick={() => setPendingRecording(undefined)}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
              <textarea
                ref={bindTextarea}
                rows={1}
                className="chat-prompt-input"
                aria-label="Ask Alfred"
                placeholder={
                  isRecordingPushToTalk
                    ? "Listening... click mic when done"
                    : isTranscribingAudio
                    ? "Preparing audio..."
                    : "Ask Alfred anything..."
                }
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                enterKeyHint="send"
                disabled={isLoading}
              />
              )}
              <button
                type="button"
                className={`chat-composer-btn ${isRecordingPushToTalk ? "recording" : ""}`}
                title={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                aria-label={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                disabled={isLoading || isTranscribingAudio}
                onClick={handleTogglePushToTalk}
              >
                <Mic size={16} strokeWidth={2} />
              </button>
              <button
                type="submit"
                className="chat-prompt-send-btn"
                disabled={isLoading || !hasComposerContent}
                title="Send message"
                aria-label={isLoading ? "Alfred is thinking" : "Send message"} aria-busy={isLoading}
              >
                {isLoading ? <VoiceSpinner size={14} /> : <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>}
              </button>
            </form>
          </div>
        ) : (
          <div className="chat-conversation-area">
            {/* Scrollable message history */}
            <div
              ref={messagesContainerRef}
              className="chat-messages-scroll"
              role="log"
              aria-live="polite"
              onScroll={handleMessagesScroll}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={
                    msg.role === "user"
                      ? "chat-bubble-user"
                      : "chat-bubble-assistant"
                  }
                >
                  {msg.role === "assistant" ? (
                    <SafeMarkdown content={msg.content} />
                  ) : (
                    <div>{msg.recording ? <VoiceNote recording={msg.recording} /> : msg.content}</div>
                  )}

                  <ErrorNotice message={msg.error} retry={handleRetry} title="Message could not be sent" />
                </div>
              ))}


            </div>

            {/* Anchored Composer within Sidebar */}
            <div className="chat-active-composer">
              {voiceModeState !== "off" ? (
                <div className="chat-composer-voice-row">
                  <form
                    className="chat-prompt-input-wrapper"
                    onSubmit={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (hasComposerContent && !isLoading) {
                        void handleSendVoiceModeText();
                      }
                    }}
                  >
                    {pendingRecording ? (
                      <div className="chat-pending-recording">
                        <VoiceNote recording={pendingRecording} />
                        <button type="button" className="chat-composer-btn" aria-label="Discard recording" title="Discard recording" onClick={() => setPendingRecording(undefined)}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                    <textarea
                      ref={bindTextarea}
                      rows={1}
                      className="chat-prompt-input"
                      aria-label="Ask Alfred while in Voice Mode"
                      placeholder="Ask Alfred..."
                      value={inputPrompt}
                      onChange={(e) => {
                        setPendingRecording(undefined);
                      setInputPrompt(e.target.value);
                        if (voiceModeActiveRef.current && voiceModeState === "listening") {
                          audioRecorder.cancel();
                        }
                      }}
                      onKeyDown={handleVoiceKeyDown}
                      enterKeyHint="send"
                      disabled={isLoading}
                    />
                    )}
                    <button
                      type="button"
                      className={`chat-composer-btn ${isRecordingPushToTalk ? "recording" : ""}`}
                      title={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                      aria-label={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                      disabled={isLoading || isTranscribingAudio}
                      onClick={handleTogglePushToTalk}
                    >
                      <Mic size={16} strokeWidth={2} />
                    </button>
                    <button
                      type="submit"
                      className="chat-prompt-send-btn"
                      disabled={isLoading || !hasComposerContent}
                      title="Send message"
                      aria-label={isLoading ? "Alfred is thinking" : "Send message"} aria-busy={isLoading}
                    >
                      {isLoading ? <VoiceSpinner size={14} /> : <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>}
                    </button>
                  </form>

                  <button
                    type="button"
                    className={`chat-voice-mute-btn ${isVoiceMuted ? "muted" : ""}`}
                    onClick={handleToggleVoiceMute}
                    aria-label={isVoiceMuted ? "Unmute microphone" : "Mute microphone"}
                    title={isVoiceMuted ? "Unmute microphone" : "Mute microphone"}
                  >
                    {isVoiceMuted ? (
                      <MicOff size={18} strokeWidth={2.2} />
                    ) : (
                      <Mic size={18} strokeWidth={2.2} />
                    )}
                  </button>

                  <button
                    type="button"
                    className="chat-voice-close-btn"
                    onClick={handleExitVoiceMode}
                    aria-label="Exit Voice Mode"
                    title="Exit Voice Mode"
                  >
                    <X size={18} strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <form
                  className="chat-composer-box"
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (hasComposerContent && !isLoading) {
                      void handleSendMessage();
                    }
                  }}
                >
                  {pendingRecording ? (
                    <div className="chat-pending-recording">
                      <VoiceNote recording={pendingRecording} />
                      <button type="button" className="chat-composer-btn" aria-label="Discard recording" title="Discard recording" onClick={() => setPendingRecording(undefined)}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                  <textarea
                    ref={bindTextarea}
                    className="chat-composer-textarea"
                    placeholder={
                      isRecordingPushToTalk
                        ? "Listening... click mic when done"
                        : isTranscribingAudio
                        ? "Preparing audio..."
                        : "Ask Alfred..."
                    }
                    rows={1}
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    enterKeyHint="send"
                    disabled={isLoading}
                    aria-label="Ask Alfred"
                  />
                  )}

                  <button
                    type="button"
                    className={`chat-composer-btn ${isRecordingPushToTalk ? "recording" : ""}`}
                    title={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                    aria-label={isRecordingPushToTalk ? "Stop recording" : "Record a voice message"}
                    disabled={isLoading || isTranscribingAudio}
                    onClick={handleTogglePushToTalk}
                  >
                    <Mic size={16} strokeWidth={2} />
                  </button>

                  <button
                    type="submit"
                    className="chat-composer-btn chat-composer-send-btn"
                    disabled={isLoading || !hasComposerContent}
                    title="Send message"
                    aria-label={isLoading ? "Alfred is thinking" : "Send message"} aria-busy={isLoading}
                  >
                    {isLoading ? <VoiceSpinner size={14} /> : <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unaltered Bottom Profile and Settings Bar */}
      <div className="chat-bottom-bar">
        <div className="user-bar-profile">
          {profile.picture ? (
            <img
              src={profile.picture ?? undefined}
              alt={displayName}
              className="user-bar-avatar-img"
            />
          ) : (
            <div className="user-bar-avatar-circle" aria-label="User avatar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#141414">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
          )}

          <div className="user-bar-label">
            {isGoogleUser ? (
              <span className="user-bar-name" title={displayName}>
                {displayName}
              </span>
            ) : (
              <button
                type="button"
                className="user-bar-signin-btn"
                onClick={() => { setSignInError(""); void Promise.resolve(loginWithGoogle()).catch(error => setSignInError(error instanceof Error ? error.message : "Could not start Google sign-in.")); }}
              >
                {displayName === "Guest"
                  ? "Sign in with Google"
                  : displayName}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          className="user-bar-settings-btn"
          aria-label="Settings"
          title="Settings"
          onClick={() => {
            if (onOpenSettings) {
              onOpenSettings();
            } else {
              window.dispatchEvent(new CustomEvent("alfred:open_settings"));
            }
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </section>
  );
}
