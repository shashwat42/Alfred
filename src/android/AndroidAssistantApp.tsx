import { getSavedOverlayMode } from "../lib/overlayMode.ts";
import { ErrorNotice } from "../components/reliability/Notifications";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AudioLines, SendHorizontal, Mic, MicOff, LoaderCircle, ExternalLink, Square, Trash2, X, Sparkles } from "lucide-react";
import Logo from "../assets/Alfred_Logo.svg";
import { AUTH_CHANGE_EVENT, AUTH_STORAGE_KEY, getSession } from "../auth/auth.ts";
import { SafeMarkdown } from "../components/SafeMarkdown.tsx";
import { boundVoiceResources, buildSafeChatContext, MAX_MESSAGE_CHAR_LIMIT, sendChatMessage, type ChatMessage } from "../lib/aiChat.ts";
import { ensureToken } from "../lib/api.ts";
import { audioRecorder } from "../lib/audioRecorder.ts";
import { VoiceNote } from "../components/VoiceNote.tsx";
import type { RecordingResult } from "../types/audio.ts";
import { getSilenceTimeout } from "../lib/voicePreferences.ts";
import { ASSISTANT_VOICE_LEVEL_EVENT, androidAssistantRequest, announceAndroidActions, hasAndroidAssistantBridge } from "./assistantBridge.ts";
import { recordAssistantSpeech } from "./voiceCapture.ts";
import "./androidAssistant.css";

type State = "Ready" | "Preparing voice" | "Listening" | "Preparing audio" | "Thinking" | "Speaking" | "Paused";
let messageSequence = 0;
const messageId = () => `${Date.now()}-${++messageSequence}`;

function ModeSwitchButton({ voice, disabled, onClick }: { voice: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className="android-assistant-mode-switch" aria-label={voice ? "Switch to text mode" : "Switch to voice mode"} title={voice ? "Switch to text mode" : "Switch to voice mode"} disabled={disabled} onClick={onClick}>{voice ? <X size={36} strokeWidth={2.5} /> : <AudioLines size={24} />}</button>;
}

function AssistantLogo({ state }: { state: State }) {
  const phase = state.toLowerCase().replaceAll(" ", "-");
  return <span className={`android-assistant-logo state-${phase}`} style={{ "--voice-level": 0 } as CSSProperties} aria-hidden="true"><img src={Logo} alt="" /></span>;
}

/** Dedicated document inside Android's system-assistant session. No Tauri IPC or stored conversation. */
export default function AndroidAssistantApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const history = useRef<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<State>("Ready");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null);
  const [voice, setVoice] = useState(false);
  const voiceRef = useRef(false);
  const [micMuted, setMicMuted] = useState(false);
  const micMutedRef = useRef(false);
  const micRevision = useRef(0);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const account = useRef(getSession()?.account.id);
  const speechDone = useRef<(() => void) | null>(null);
  const bridgeAvailable = hasAndroidAssistantBridge();

  const stop = useCallback(() => {
    voiceRef.current = false;
    generation.current++;
    abort.current?.abort();
    audioRecorder.cancel();
    if (hasAndroidAssistantBridge()) void androidAssistantRequest("cancelVoice").catch(() => {});
    window.speechSynthesis?.cancel();
    speechDone.current?.();
    speechDone.current = null;
    busyRef.current = false;
    micMutedRef.current = false; setMicMuted(false);
    setVoice(false); setBusy(false); setState("Ready"); setAudioLevel(0);
  }, []);

  useEffect(() => {
    const onAccount = () => {
      const next = getSession()?.account.id;
      if (account.current && account.current !== next) {
        stop(); history.current = []; setMessages([]); setRetryPrompt(null);
        setError("Your account changed. This conversation was cleared.");
      }
      account.current = next;
    };
    const onStorage = (event: StorageEvent) => { if (event.key === AUTH_STORAGE_KEY || event.key === null) onAccount(); };
    const onLevel = (event: Event) => { if (voiceRef.current) setAudioLevel((event as CustomEvent<number>).detail); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTH_CHANGE_EVENT, onAccount);
    window.addEventListener("pagehide", stop);
    window.addEventListener(ASSISTANT_VOICE_LEVEL_EVENT, onLevel);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTH_CHANGE_EVENT, onAccount);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener(ASSISTANT_VOICE_LEVEL_EVENT, onLevel);
      stop(); history.current = [];
    };
  }, [stop]);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages, state]);

  const send = async (raw: string, recording?: RecordingResult): Promise<string> => {
    const text = raw.trim();
    recording ??= history.current.at(-1)?.error && history.current.at(-1)?.content === text ? history.current.at(-1)?.recording : undefined;
    if (!text || busyRef.current) return "";
    if (text.length > MAX_MESSAGE_CHAR_LIMIT) throw new Error(`Keep messages under ${MAX_MESSAGE_CHAR_LIMIT} characters.`);
    busyRef.current = true; setBusy(true); setState("Thinking"); setError("");
    const controller = new AbortController(); abort.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
    const previous = history.current.filter((message, index, all) => !(index === all.length - 1 && message.error && message.content === text));
    try {
      await ensureToken();
      if (timedOut) throw new Error("Alfred took too long to respond. Retry your question.");
      if (controller.signal.aborted) return "";
      const expectedAccountId = getSession()?.account.id;
      if (!expectedAccountId) throw new Error("Open Alfred to connect or sign in, then try again.");
      account.current = expectedAccountId;
      const failed = history.current.at(-1);
      const user: ChatMessage = { id: failed?.error && failed.content === text ? failed.id : messageId(), role: "user", content: text, recording, timestamp: Date.now() };
      history.current = boundVoiceResources([...previous, user]); setMessages(history.current);
      const response = await sendChatMessage(buildSafeChatContext(previous, text), controller.signal, { preserveAccount: true, expectedAccountId, recording, requestId: user.id });
      if (controller.signal.aborted || expectedAccountId !== getSession()?.account.id) return "";
      if (!response.message?.content?.trim()) throw new Error("Alfred returned an empty response. Please retry your question.");
      history.current = [...history.current, { id: messageId(), role: "assistant", content: response.message.content, timestamp: Date.now() }];
      setMessages(history.current);
      setRetryPrompt(null);
      if (response.actionsExecuted?.length) announceAndroidActions(expectedAccountId, response.actionsExecuted.map((action) => action.type));
      return response.message.content;
    } catch (err) {
      if (!controller.signal.aborted || timedOut) {
        history.current = history.current.map((message) => message.role === "user" && message === history.current[history.current.length - 1] ? { ...message, error: "not sent" } : message);
        setMessages(history.current);
        setRetryPrompt(text);
        if (timedOut) throw new Error("Alfred took too long to respond. Retry your question.", { cause: err });
        throw err;
      }
      return "";
    } finally {
      clearTimeout(timer);
      if (abort.current === controller) { abort.current = null; busyRef.current = false; setBusy(false); setState("Ready"); }
    }
  };

  const toggleVoice = async (savedPrompt?: string) => {
    if (voiceRef.current) { stop(); return; }
    if (busyRef.current) return;
    const turn = ++generation.current;
    voiceRef.current = true; setVoice(true); setError(""); setState("Preparing voice");
    const current = () => voiceRef.current && turn === generation.current;
    try {
      let nextPrompt = savedPrompt;
      while (current()) {
        if (micMutedRef.current) {
          setState("Paused");
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        let recording: RecordingResult | undefined = nextPrompt ? history.current.at(-1)?.recording : undefined;
        let text = nextPrompt;
        nextPrompt = undefined;
        if (!text) {
          setState("Listening");
          const recordingRevision = micRevision.current;
          let audio: RecordingResult;
          try { audio = await recordAssistantSpeech(getSilenceTimeout()); }
          catch (err) { if (current() && recordingRevision !== micRevision.current) continue; throw err; }
          if (!current()) break;
          if (micMutedRef.current || recordingRevision !== micRevision.current) continue;
          recording = audio;
          text = "Voice message";
        }
        const reply = await send(text, recording);
        if (!current()) break;
        if (reply && "speechSynthesis" in window) {
          setState("Speaking");
          await new Promise<void>((resolve) => {
            speechDone.current = resolve;
            const utterance = new SpeechSynthesisUtterance(reply);
            utterance.onend = utterance.onerror = () => { speechDone.current = null; resolve(); };
            window.speechSynthesis.speak(utterance);
          });
        }
      }
    } catch (err) {
      if (current()) {
        stop(); setVoice(true); setState("Paused");
        setError(err instanceof Error ? err.message : "Voice failed. Please retry.");
      }
    } finally { if (turn === generation.current) stop(); }
  };

  const startVoiceRef = useRef(toggleVoice);
  useEffect(() => { startVoiceRef.current = toggleVoice; });
  useEffect(() => {
    if (getSavedOverlayMode() === "voice") void startVoiceRef.current();
  }, []);
  useEffect(() => audioRecorder.addLevelListener(setAudioLevel), []);

  const native = (type: "dismiss" | "openApp") => {
    stop();
    void androidAssistantRequest(type).catch((err: unknown) => setError(err instanceof Error ? err.message : "Android action failed."));
  };
  const toggleMic = () => {
    if (!voiceRef.current) { void toggleVoice(); return; }
    const muted = !micMutedRef.current;
    micRevision.current++;
    micMutedRef.current = muted; setMicMuted(muted); setAudioLevel(0);
    if (muted && (state === "Listening" || state === "Preparing voice")) {
      audioRecorder.cancel();
      if (hasAndroidAssistantBridge()) void androidAssistantRequest("cancelVoice").catch(() => {});
      setState("Paused");
    }
  };
  return <main className={`android-assistant${voice ? " is-voice" : ""}`} aria-label="Alfred floating assistant">
    {voice && <div className="android-assistant-dock">
      <div className="android-assistant-voice-bar">
        <button className="android-assistant-logo-button" aria-label="Assistant options" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}><AssistantLogo state={state} /></button>
        <span className="android-assistant-activity" role="status" aria-label={state}>
          {state === "Thinking" || state === "Preparing audio" || state === "Preparing voice" ? <LoaderCircle className="android-assistant-spinner" size={30} /> : <span className={`android-assistant-wave${state === "Listening" && !micMuted ? " is-recording" : ""}`} style={{ "--voice-level": state === "Listening" && !micMuted ? Math.min(1, audioLevel * 4) : 0 } as CSSProperties} aria-hidden="true">{[12, 25, 17, 34, 24, 40, 28, 18, 30, 14].map((height, index) => <i key={index} style={{ height, animationDelay: `${index * -0.09}s` }} />)}</span>}
        </span>
        <button className="android-assistant-mic" aria-label={micMuted || state === "Paused" ? "Turn microphone on" : "Turn microphone off"} aria-pressed={!micMuted && state !== "Paused"} onClick={toggleMic}>{micMuted || state === "Paused" ? <MicOff size={28} /> : <Mic size={28} />}</button>
      </div>
      <ModeSwitchButton voice onClick={() => { setMenuOpen(false); stop(); }} />
    </div>}
    <form className="android-assistant-dock" hidden={voice} onSubmit={(event) => {
      event.preventDefault(); if (voice || busyRef.current || !prompt.trim()) return;
      const text = prompt; setPrompt("");
      void send(text).catch((err: unknown) => { setPrompt(text); setError(err instanceof Error ? err.message : "Could not connect. Check your network and try again."); });
    }}>
      <div className="android-assistant-composer">
        <input aria-label="Ask Alfred" placeholder="Ask Alfred" maxLength={MAX_MESSAGE_CHAR_LIMIT} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={voice} />
        {busy ? <button type="button" className="android-assistant-stop" aria-label="Stop response" onClick={stop}><Square size={20} /></button> : <button type="submit" aria-label="Send message" disabled={voice || !prompt.trim()}><SendHorizontal size={30} /></button>}
      </div>
      <ModeSwitchButton voice={false} disabled={busy} onClick={() => { setMenuOpen(false); void toggleVoice(); }} />
    </form>
    {!voice && <button className="android-assistant-options" aria-label="Assistant options" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}>Options</button>}
    {menuOpen && <div className="android-assistant-menu" role="menu" aria-label="Assistant options">
      <button role="menuitem" onClick={() => native("dismiss")}><X size={16} />Dismiss assistant</button>
      <button role="menuitem" onClick={() => native("openApp")}><ExternalLink size={16} />Open Alfred app</button>
      <button role="menuitem" disabled={!messages.length && !error} onClick={() => { stop(); history.current = []; setMessages([]); setError(""); setRetryPrompt(null); setPrompt(""); setMenuOpen(false); }}><Trash2 size={16} />New conversation</button>
    </div>}
    <ErrorNotice message={error || (!bridgeAvailable ? "Assistant preview only. Install the Android app to use system controls." : null)} title="Assistant unavailable" retry={bridgeAvailable && error && !busy ? () => {
      if (voice) { void toggleVoice(retryPrompt ?? undefined); }
      else if (retryPrompt) { void send(retryPrompt).catch((err: unknown) => setError(err instanceof Error ? err.message : "Please retry.")); }
      else setError("");
    } : undefined} />
    <div className="android-assistant-messages" ref={list} role="log" aria-label="Conversation">
      {messages.map((message) => <article key={message.id} className={`android-assistant-message is-${message.role}`} aria-label={message.role === "user" ? "You" : "Alfred"}>{message.role === "assistant" ? <SafeMarkdown content={message.content} /> : <p>{message.recording ? <VoiceNote recording={message.recording} /> : message.content}</p>}</article>)}
      {messages.length === 0 && (busy || state === "Preparing audio") && <div className="android-assistant-thinking" role="status"><Sparkles size={14} />{state === "Preparing audio" ? "Preparing audio…" : "Alfred is thinking…"}</div>}
    </div>
  </main>;
}
