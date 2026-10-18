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
const harness = { handlers, closes: 0 };
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
      if (id === '@tauri-apps/api/event') return '\0overlay-events';
      if (id === '@tauri-apps/api/webviewWindow') return '\0overlay-window';
      if (id === '@tauri-apps/api/window') return '\0overlay-monitor';
    },
    load(id) {
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
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
try {
  const { audioRecorder } = await server.ssrLoadModule('/src/lib/audioRecorder.ts');
  audioRecorder.recordTurn = () => {
    starts++;
    return new Promise((_resolve, reject) => { rejectRecording = reject; });
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
  assert.equal(container.querySelector('[aria-label="Stop voice mode (Esc)"]'), null);
  const beforeSummon = starts;
  await act(async () => { handlers.get('alfred:overlay-summon')!.forEach(handler => handler()); await settle(); });
  assert.ok(starts > beforeSummon, 'summoning must restart voice mode');
  assert.ok(container.querySelector('[aria-label="Stop voice mode (Esc)"]'));
  await act(async () => { window.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape' })); await settle(); });
  assert.equal(harness.closes, 1, 'explicit dismissal must close the renderer');
  // Native closing is stubbed, so switch the still-mounted view to quick input
  // and verify its asynchronous event setup under StrictMode as well.
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="Switch to normal mode"]')!.click();
    await settle();
  });
  await act(settle);
  assert.equal(handlers.get('alfred:overlay-summon')?.size, 2, 'one root and one quick-input subscription');
  await act(async () => { root.unmount(); await settle(); });
  assert.equal(handlers.get('alfred:overlay-summon')?.size, 0);
  assert.equal(handlers.get('alfred:overlay-hidden')?.size, 0);
  console.log('PASS: hidden overlay releases voice capture, summon resumes it, dismissal closes the view, and StrictMode subscriptions are cleaned up.');
} finally {
  await act(async () => { root.unmount(); await settle(); });
  await server.close();
  await dom.happyDOM.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  Reflect.deleteProperty(globalThis, '__overlayHarness');
}
