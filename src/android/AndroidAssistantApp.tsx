import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUp, ArrowLeftRight, ExternalLink, MoreHorizontal, RotateCcw, Square, Trash2, X, Sparkles } from "lucide-react";
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
  return <button type="button" className="android-assistant-mode-switch" aria-label={voice ? "Switch to text mode" : "Switch to voice mode"} title={voice ? "Switch to text mode" : "Switch to voice mode"} disabled={disabled} onClick={onClick}><ArrowLeftRight size={18} /></button>;
}

function AssistantLogo({ state, level = 0 }: { state: State; level?: number }) {
  const phase = state.toLowerCase().replaceAll(" ", "-");
  return <span className={`android-assistant-logo state-${phase}`} style={{ "--voice-level": state === "Listening" ? level : 0 } as CSSProperties} aria-hidden="true"><img src={Logo} alt="" /></span>;
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
      const user: ChatMessage = { id: messageId(), role: "user", content: text, recording, timestamp: Date.now() };
      history.current = boundVoiceResources([...previous, user]); setMessages(history.current);
      const response = await sendChatMessage(buildSafeChatContext(previous, text), controller.signal, { preserveAccount: true, expectedAccountId, recording });
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
        let recording: RecordingResult | undefined = nextPrompt ? history.current.at(-1)?.recording : undefined;
        let text = nextPrompt;
        nextPrompt = undefined;
        if (!text) {
          setState("Listening");
          const audio = await recordAssistantSpeech(getSilenceTimeout());
          if (!current()) break;
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

  const native = (type: "dismiss" | "openApp") => {
    stop();
    void androidAssistantRequest(type).catch((err: unknown) => setError(err instanceof Error ? err.message : "Android action failed."));
  };
  return <main className={`android-assistant${voice ? " is-voice" : ""}`} aria-label="Alfred floating assistant">
    {voice && <div className="android-assistant-voice-bar">
      <span className={`android-assistant-status${state === "Listening" ? " is-listening" : ""}`} role="status"><i />{state}</span>
      <AssistantLogo state={state} level={audioLevel} />
      <div className="android-assistant-controls">
        <button aria-label="Assistant options" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={18} /></button>
        <ModeSwitchButton voice onClick={() => { setMenuOpen(false); stop(); }} />
        <button className="android-assistant-stop" aria-label="Stop voice mode" title="Stop voice mode" onClick={stop}><Square size={16} fill="currentColor" /></button>
        <button aria-label="Dismiss assistant" onClick={() => native("dismiss")}><X size={20} /></button>
      </div>
    </div>}
    <form className="android-assistant-composer" hidden={voice} onSubmit={(event) => {
      event.preventDefault(); if (voice || busyRef.current || !prompt.trim()) return;
      const text = prompt; setPrompt("");
      void send(text).catch((err: unknown) => { setPrompt(text); setError(err instanceof Error ? err.message : "Could not connect. Check your network and try again."); });
    }}>
      <AssistantLogo state={state} />
      <input aria-label="Ask Alfred" placeholder="Ask Alfred…" maxLength={MAX_MESSAGE_CHAR_LIMIT} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={voice} />
      <button type="button" aria-label="Assistant options" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={18} /></button>
      <ModeSwitchButton voice={false} disabled={busy} onClick={() => { setMenuOpen(false); void toggleVoice(); }} />
      {busy ? <button type="button" className="android-assistant-stop" aria-label="Stop response" onClick={stop}><Square size={16} fill="currentColor" /></button> : <button type="submit" aria-label="Send message" disabled={voice || !prompt.trim()}><ArrowUp size={20} /></button>}
      <button type="button" aria-label="Dismiss assistant" onClick={() => native("dismiss")}><X size={20} /></button>
    </form>
    {menuOpen && <div className="android-assistant-menu" role="menu" aria-label="Assistant options">
      <button role="menuitem" onClick={() => native("openApp")}><ExternalLink size={16} />Open Alfred app</button>
      <button role="menuitem" disabled={!messages.length && !error} onClick={() => { stop(); history.current = []; setMessages([]); setError(""); setRetryPrompt(null); setPrompt(""); setMenuOpen(false); }}><Trash2 size={16} />New conversation</button>
    </div>}
    {(!bridgeAvailable || error) && <section className="android-assistant-error" role="alert">
      <strong>{voice ? retryPrompt ? "Couldn't get a response" : "Voice paused" : "Couldn't complete your request"}</strong>
      <p>{error || "Assistant preview only. Install the Android app to use system controls."}</p>
      {bridgeAvailable && error && <button className="android-assistant-retry" type="button" onClick={() => {
        if (voice) { void toggleVoice(retryPrompt ?? undefined); }
        else if (retryPrompt) { void send(retryPrompt).catch((err: unknown) => setError(err instanceof Error ? err.message : "Please retry.")); }
        else setError("");
      }} disabled={busy}><RotateCcw size={15} />{retryPrompt ? "Retry response" : "Try again"}</button>}
    </section>}
    <div className="android-assistant-messages" ref={list} role="log" aria-label="Conversation">
      {messages.map((message) => <article key={message.id} className={`android-assistant-message is-${message.role}`} aria-label={message.role === "user" ? "You" : "Alfred"}>{message.error && <span>Not sent</span>}{message.role === "assistant" ? <SafeMarkdown content={message.content} /> : <p>{message.recording ? <VoiceNote recording={message.recording} /> : message.content}</p>}</article>)}
      {(busy || state === "Preparing audio") && <div className="android-assistant-thinking" role="status"><Sparkles size={14} />{state === "Preparing audio" ? "Preparing audio…" : "Alfred is thinking…"}</div>}
    </div>
  </main>;
}
