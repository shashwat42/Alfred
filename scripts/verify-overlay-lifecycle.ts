import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const dom = new Window({ url: 'http://localhost:5173/?window=overlay' });
const names = ['window', 'document', 'navigator', 'localStorage', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, {
  configurable: true, writable: true,
  value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true
    : name === 'requestAnimationFrame' || name === 'cancelAnimationFrame' ? dom[name].bind(dom)
      : dom[name as keyof Window],
});
const handlers = new Map<string, Set<() => void>>();
const harness = { handlers, closes: 0, replies: [] as ((value: unknown) => void)[] };
Object.assign(globalThis, { __overlayHarness: harness });
Object.assign(dom, { __TAURI_INTERNALS__: {} });
const server = await createServer({
  mode: 'development', cacheDir: 'node_modules/.vite-overlay-lifecycle',
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  server: { middlewareMode: true, hmr: false }, appType: 'custom',
  ssr: { noExternal: ['@tauri-apps/api'] },
  plugins: [{
    name: 'isolated-overlay-native-adapter', enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/aiChat.ts')) return '\0overlay-chat';
      if (id === '@tauri-apps/api/event') return '\0overlay-events';
      if (id === '@tauri-apps/api/webviewWindow') return '\0overlay-window';
      if (id === '@tauri-apps/api/window') return '\0overlay-monitor';
    },
    load(id) {
      if (id === '\0overlay-chat') return `export const boundVoiceResources=x=>x; export const buildSafeChatContext=x=>x; export const sendChatMessage=()=>new Promise(resolve=>globalThis.__overlayHarness.replies.push(resolve));`;
      if (id === '\0overlay-events') return `export async function listen(name, handler) {
        await Promise.resolve();
        const handlers = globalThis.__overlayHarness.handlers;
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name).add(handler);
        return () => handlers.get(name).delete(handler);
      }`;
      if (id === '\0overlay-window') return `export function getCurrentWebviewWindow() {
        return { close: async () => { globalThis.__overlayHarness.closes++; } };
      }`;
      if (id === '\0overlay-monitor') return 'export async function currentMonitor() { return null; }';
    },
  }],
});
const { createRoot } = await import('react-dom/client');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
let starts = 0, cancels = 0;
let rejectRecording: ((error: Error) => void) | undefined;
let resolveRecording: ((value: unknown) => void) | undefined;
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const idleTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
  if (delay === 60000) { const timer = {} as ReturnType<typeof setTimeout>; idleTimers.set(timer, callback); return timer; }
  return nativeSetTimeout(callback, delay, ...args);
}) as typeof setTimeout;
globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => { if (!idleTimers.delete(timer)) nativeClearTimeout(timer); }) as typeof clearTimeout;
const expireIdle = async () => { assert.equal(idleTimers.size, 1, 'Exactly one one-minute idle timer'); const [timer, callback] = [...idleTimers][0]; idleTimers.delete(timer); await act(async () => { callback(); await settle(); }); };
const click = async (label: string) => { const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`); assert.ok(button, label); await act(async () => { button.click(); await settle(); }); };
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
try {
  const { audioRecorder } = await server.ssrLoadModule('/src/lib/audioRecorder.ts');
  audioRecorder.recordTurn = () => {
    starts++;
    return new Promise((resolve, reject) => { resolveRecording = resolve; rejectRecording = reject; });
  };
  audioRecorder.cancel = () => {
    cancels++;
    rejectRecording?.(new Error('Test recording cancelled'));
    rejectRecording = undefined;
  };
  localStorage.setItem('alfred_overlay_mode', 'voice');
  const { default: OverlayApp } = await server.ssrLoadModule('/src/overlay/OverlayApp.tsx');
  await act(async () => { root.render(createElement(StrictMode, null, createElement(OverlayApp))); await settle(); });
  await act(settle);
  assert.equal(handlers.get('alfred:overlay-summon')?.size, 1, 'StrictMode must not leak native subscriptions');
  assert.equal(handlers.get('alfred:overlay-hidden')?.size, 1);
  const beforeHide = cancels;
  await act(async () => { handlers.get('alfred:overlay-hidden')!.forEach(handler => handler()); await settle(); });
  assert.ok(cancels > beforeHide, 'hiding must release the active microphone');
  assert.equal(container.querySelector('[aria-label="Mute microphone"]'), null);
  const beforeSummon = starts;
  await act(async () => { handlers.get('alfred:overlay-summon')!.forEach(handler => handler()); await settle(); });
  assert.ok(starts > beforeSummon, 'summoning must restart voice mode');
  assert.ok(container.querySelector('[aria-label="Mute microphone"]'));
  const dock = container.querySelector('.desktop-overlay-dock')!;
  assert.equal(dock.firstElementChild?.getAttribute('aria-label'), 'Clear chat');
  assert.equal(dock.lastElementChild?.getAttribute('aria-label'), 'Switch to text mode');
  assert.equal(container.querySelector('[aria-label="Dismiss overlay (Esc)"]'), null);
  await act(async () => { resolveRecording?.({ audio: new Blob(['stub'], { type: 'audio/wav' }), durationMs: 1000 }); await settle(); });
  assert.ok(container.querySelector('.desktop-overlay-activity .desktop-overlay-spinner'), 'Thinking replaces recording wave');
  await click('Clear chat');
  await act(async () => { harness.replies.shift()?.({ message: { content: 'stale reply' } }); await settle(); });
  assert.ok(!container.textContent?.includes('stale reply'), 'Cleared voice requests cannot restore old history');
  await click('Mute microphone');
  await click('Clear chat');
  assert.ok(container.querySelector('[aria-label="Unmute microphone"]'), 'Clearing chat preserves mute');
  await click('Unmute microphone');
  await act(async () => { resolveRecording?.({ audio: new Blob(['stub'], { type: 'audio/wav' }), durationMs: 1000 }); await settle(); });
  await act(async () => { harness.replies.shift()?.({ message: { content: 'retained reply' } }); await settle(); });
  assert.ok(container.textContent?.includes('retained reply'));
  await click('Switch to text mode');
  assert.ok(container.textContent?.includes('retained reply'), 'Mode switch retains chat');
  assert.equal(harness.closes, 0, 'Mode switch does not dismiss');
  const textDock = container.querySelector('.desktop-overlay-dock')!;
  assert.equal(textDock.firstElementChild?.getAttribute('aria-label'), 'Clear chat');
  assert.equal(textDock.lastElementChild?.getAttribute('aria-label'), 'Switch to voice mode');
  await expireIdle();
  assert.ok(!container.textContent?.includes('retained reply'), 'One minute of inactivity clears the conversation');
  await click('Clear chat');
  assert.ok(container.querySelector('input[aria-label="Ask Alfred"]'));
  await act(async () => { window.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); });
  // Quick input handles Escape on its focused input.
  await act(async () => { container.querySelector('input')!.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); });
  assert.equal(harness.closes, 1, 'Escape still dismisses the overlay');
  await act(settle);
  assert.equal(handlers.get('alfred:overlay-summon')?.size, 2, 'one root and one quick-input subscription');
  await act(async () => { root.unmount(); await settle(); });
  assert.equal(handlers.get('alfred:overlay-summon')?.size, 0);
  assert.equal(handlers.get('alfred:overlay-hidden')?.size, 0);
  console.log('PASS: clear chat in both modes, stale-response cancellation, mute preservation, one-minute expiration, mode switching, hide/summon, Escape, and StrictMode cleanup.');
} finally {
  await act(async () => { root.unmount(); await settle(); });
  globalThis.setTimeout = nativeSetTimeout;
  globalThis.clearTimeout = nativeClearTimeout;
  await server.close();
  await dom.happyDOM.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  Reflect.deleteProperty(globalThis, '__overlayHarness');
}
