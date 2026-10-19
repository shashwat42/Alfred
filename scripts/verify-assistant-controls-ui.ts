import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const dom = new Window({ url: 'http://localhost:5173/?window=android-assistant' });
const names = ['window', 'document', 'navigator', 'localStorage', 'CustomEvent', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom[name as keyof Window] });
Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Windows NT 10.0' });
const harness = {
  enabled: false, failWrite: false, commands: [] as string[], recordings: 0, cancels: 0,
  resolveRecording: undefined as undefined | ((value: unknown) => void),
  rejectRecording: undefined as undefined | ((error: Error) => void),
  resolveReply: undefined as undefined | ((value: unknown) => void),
};
Object.assign(globalThis, { __assistantUiHarness: harness });
const prefix = 'const h = globalThis.__assistantUiHarness;';
const mocks: Record<string, string> = {
  '/auth/auth.ts': 'export const AUTH_CHANGE_EVENT="auth-change", AUTH_STORAGE_KEY="auth"; export const isTauri=()=>true; export const getSession=()=>({account:{id:"isolated-test"}});',
  '/lib/api.ts': 'export const ensureToken=async()=>{};',
  '/lib/aiChat.ts': prefix + 'export const MAX_MESSAGE_CHAR_LIMIT=10000; export const boundVoiceResources=x=>x; export const buildSafeChatContext=x=>x; export const sendChatMessage=()=>new Promise(resolve=>{h.resolveReply=resolve;});',
  '/lib/audioRecorder.ts': prefix + 'export const audioRecorder={cancel(){h.cancels++; h.rejectRecording?.(new Error("Recording cancelled")); h.rejectRecording=undefined;}};',
  '/android/voiceCapture.ts': prefix + 'export const recordAssistantSpeech=()=>{h.recordings++; return new Promise((resolve,reject)=>{h.resolveRecording=resolve;h.rejectRecording=reject;});};',
  '/android/assistantBridge.ts': prefix + 'export const ASSISTANT_VOICE_LEVEL_EVENT="voice-level"; export const hasAndroidAssistantBridge=()=>true; export const announceAndroidActions=()=>{}; export const androidAssistantRequest=async(type)=>{h.commands.push(type);};',
  '@tauri-apps/api/core': prefix + 'export async function invoke(command,args){h.commands.push(command); if(command==="get_launch_on_startup")return h.enabled; if(h.failWrite)throw new Error("Test registration denied"); h.enabled=args.enabled;return h.enabled;}',
};
const server = await createServer({ ssr: { noExternal: ['@tauri-apps/api'] }, mode: 'development', cacheDir: 'node_modules/.vite-assistant-ui-tests', optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [{
  name: 'isolated-assistant-ui', enforce: 'pre',
  resolveId(id) { const key = Object.keys(mocks).find(key => (id.endsWith(key) || (key.startsWith("/") && id.endsWith(key.slice(key.lastIndexOf("/")))))); if(key) return '\0assistant-test:' + key; },
  load(id) { if(id.startsWith('\0assistant-test:')) return mocks[id.slice('\0assistant-test:'.length)]; },
}] });
const { createRoot } = await import('react-dom/client');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
const byLabel = (label: string) => { const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? Array.from(container.querySelectorAll("button")).find(button => button.textContent === label); assert.ok(button, label); return button; };
const click = async (label: string) => { await act(async () => { byLabel(label).click(); await settle(); }); };
try {
  const { default: AndroidAssistantApp } = await server.ssrLoadModule('/src/android/AndroidAssistantApp.tsx');
  await act(async () => { root.render(createElement(AndroidAssistantApp)); await settle(); });
  await click('Switch to voice mode');
  assert.equal(harness.recordings, 1);
  assert.ok(container.querySelector('.android-assistant-wave.is-recording'));
  await click('Turn microphone off');
  assert.ok(container.querySelector('.is-voice'), 'Muting keeps voice mode open');
  assert.equal(container.querySelector('.android-assistant-wave.is-recording'), null);
  assert.equal(harness.recordings, 1, 'Muted microphone cannot start another recording');
  await click('Turn microphone on');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
  assert.equal(harness.recordings, 2);
  await click('Turn microphone off');
  await click('Turn microphone on');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
  assert.equal(harness.recordings, 3, 'Mic resumes after recording cancellation');
  await act(async () => { harness.resolveRecording?.({ audio: new Blob(['stub'], { type: 'audio/wav' }), durationMs: 1000 }); await settle(); });
  assert.ok(container.querySelector('.android-assistant-activity .android-assistant-spinner'), 'Thinking replaces the waveform');
  await click('Turn microphone off');
  await act(async () => { harness.resolveReply?.({ message: { content: 'Isolated test reply' } }); await settle(); });
  assert.equal(harness.recordings, 3, 'A muted mic stays off after the reply');
  await click('Switch to text mode');
  assert.equal(container.querySelector('.is-voice'), null);
  assert.ok(!harness.commands.includes('dismiss'), 'Mode switch must not dismiss the assistant');
  assert.ok(container.textContent?.includes('Isolated test reply'), 'Mode switch preserves the conversation');
  await click('Assistant options'); await click('Dismiss assistant');
  assert.equal(harness.commands.at(-1), 'dismiss');

  const { StartupSettings } = await server.ssrLoadModule('/src/components/dashboard/StartupSettings.tsx');
  await act(async () => { root.render(createElement(StartupSettings)); await settle(); });
  const toggle = () => container.querySelector<HTMLInputElement>('#launch-on-startup')!;
  assert.equal(toggle().checked, false);
  await act(async () => { toggle().click(); await settle(); });
  assert.equal(harness.enabled, true); assert.equal(toggle().checked, true);
  harness.failWrite = true;
  await act(async () => { toggle().click(); await settle(); });
  assert.equal(toggle().checked, true, 'Failed changes preserve the registered state');
  assert.match(container.textContent!, /registration denied/);
  harness.failWrite = false;
  await act(async () => { toggle().click(); await settle(); });
  assert.equal(harness.enabled, false);
  console.log('PASS: Android mode switching, mute/resume, thinking animation, conversation preservation, dismiss, and isolated Windows startup toggle/error handling.');
} finally {
  await act(async () => root.unmount()); await server.close(); await dom.happyDOM.abort();
  Reflect.deleteProperty(globalThis, '__assistantUiHarness');
  for (const [name, descriptor] of saved) { if(descriptor) Object.defineProperty(globalThis,name,descriptor); else Reflect.deleteProperty(globalThis,name); }
}
