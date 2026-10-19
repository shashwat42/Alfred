import { AUTH_CHANGE_EVENT, AUTH_STORAGE_KEY, getSession } from "../auth/auth.ts";

interface NativeAssistantBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}
declare global { interface Window { AlfredAndroid?: NativeAssistantBridge } }

export interface AssistantStatus { active: boolean; supported: boolean; roleAvailable: boolean; settingsAvailable: boolean; sdk: number }
const pending = new Map<string, { type: string; resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>();
let sequence = 0;
export function hasAndroidAssistantBridge() { return typeof window !== "undefined" && !!window.AlfredAndroid; }

export const ASSISTANT_VOICE_LEVEL_EVENT = "alfred:assistant_voice_level";

export function androidAssistantRequest(type: "status" | "setup" | "viewport" | "checkUpdates" | "downloadUpdate" | "dismiss" | "openApp" | "recordVoice" | "cancelVoice", silenceMs?: number): Promise<Record<string, unknown>> {
  const bridge = window.AlfredAndroid;
  if (!bridge) return Promise.reject(new Error("The Android assistant bridge is unavailable. Open the installed Android app."));
  if (type === "cancelVoice") {
    for (const [id, request] of pending) if (request.type === "recordVoice") {
      pending.delete(id); request.reject(new DOMException("Voice capture cancelled.", "AbortError"));
    }
  }
  bridge.onmessage = (event) => {
    try {
      const result = JSON.parse(event.data) as Record<string, unknown>;
      if (typeof result.id !== "string") return;
      const request = pending.get(result.id);
      if (!request) return;
      if (request.type === "recordVoice" && result.event === "voiceLevel") {
        if (typeof result.level === "number" && Number.isFinite(result.level)) {
          window.dispatchEvent(new CustomEvent(ASSISTANT_VOICE_LEVEL_EVENT, { detail: Math.max(0, Math.min(1, result.level)) }));
        }
        return;
      }
      pending.delete(result.id);
      if (typeof result.error === "string") request.reject(new Error(result.error));
      else request.resolve(result);
    } catch { /* Ignore malformed messages. */ }
  };
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++sequence}`;
    const timer = window.setTimeout(() => { pending.delete(id); reject(new Error("Android did not respond. Please try again.")); }, type === "recordVoice" ? 45000 : type === "checkUpdates" ? 60000 : 5000);
    pending.set(id, {
      type,
      resolve: (result) => { clearTimeout(timer); resolve(result); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    try { bridge.postMessage(JSON.stringify({ type, id, ...(type === "recordVoice" && silenceMs !== undefined ? { silenceMs } : {}) })); }
    catch { pending.get(id)?.reject(new Error("Android assistant action failed.")); pending.delete(id); }
  });
}

// Store invalidation metadata only, never messages, prompts, responses or credentials.
export const ASSISTANT_ACTION_KEY = "alfred_assistant_action_revision";
export function announceAndroidActions(accountId: string, types: string[]) {
  try { localStorage.setItem(ASSISTANT_ACTION_KEY, JSON.stringify({ accountId, types, revision: Date.now() })); }
  catch { /* Normal foreground refresh remains a fallback when storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent("alfred:action_executed", { detail: { actions: types.map((type) => ({ type })) } }));
}

export function installAndroidAssistantSync() {
  if (!hasAndroidAssistantBridge()) return;
  window.addEventListener("storage", (event) => {
    if (event.key === AUTH_STORAGE_KEY) window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: getSession() }));
    if (event.key !== ASSISTANT_ACTION_KEY || !event.newValue) return;
    try {
      const value = JSON.parse(event.newValue) as { accountId: string; types: unknown[] };
      if (value.accountId !== getSession()?.account.id || !Array.isArray(value.types)) return;
      const types = value.types.filter((type): type is string => typeof type === "string" && /^(task|note|schedule)_(created|updated|completed|deleted)$/.test(type));
      window.dispatchEvent(new CustomEvent("alfred:action_executed", { detail: { actions: types.map((type) => ({ type })) } }));
    } catch { /* Invalid invalidation records are ignored. */ }
  });
}
