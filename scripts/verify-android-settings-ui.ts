import assert from 'node:assert/strict';
import { act, createElement, Fragment } from 'react';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const dom = new Window({ url: 'http://localhost:5173/' });
const names = ['window', 'document', 'navigator', 'localStorage', 'Event', 'CustomEvent', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom[name as keyof Window] });
const server = await createServer({ mode: 'development', cacheDir: 'node_modules/.vite-android-settings-tests', optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { createRoot } = await import('react-dom/client');
document.body.innerHTML = '<div id="root"></div>';
const root = createRoot(document.getElementById('root')!);
const requests: string[] = [];
let response: Record<string, unknown> = {};
const bridge = { onmessage: null as null | ((event: { data: string }) => void), postMessage(raw: string) {
  const request = JSON.parse(raw); requests.push(request.type);
  queueMicrotask(() => bridge.onmessage?.({ data: JSON.stringify({ id: request.id, ...response }) }));
} };
const text = () => document.body.textContent!;
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes(name));
const click = async (name: string) => { const item = button(name); assert.ok(item); await act(async () => { item.click(); }); };
try {
  const { AndroidAppUpdateSettings } = await server.ssrLoadModule('/src/android/AndroidAppUpdateSettings.tsx');
  const { AndroidAssistantSetup } = await server.ssrLoadModule('/src/android/AndroidAssistantSetup.tsx');
  const { NotificationHost } = await server.ssrLoadModule('/src/components/reliability/Notifications.tsx');
  const render = (component: typeof AndroidAppUpdateSettings) => root.render(createElement(Fragment, null, createElement(NotificationHost), createElement(component)));
  await act(async () => render(AndroidAppUpdateSettings));
  assert.ok(button('Check for updates')?.disabled, 'Browser previews cannot invoke Android updates');
  window.AlfredAndroid = bridge;
  await act(async () => render(AndroidAppUpdateSettings));
  assert.equal(requests.length, 0, 'Update checks require an explicit click');
  response = { currentVersion: '0.1.0-beta.4.1', update: { version: '0.1.0-beta.4.2', versionCode: 1006 } };
  await click('Check for updates');
  assert.match(text(), /0\.1\.0-beta\.4\.2 is available/);
  assert.match(text(), /Installed version: 0\.1\.0-beta\.4\.1/);
  assert.deepEqual(requests, ['checkUpdates']);
  response = { error: 'Connection unavailable' };
  await click('Check for updates');
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Connection unavailable/);
  assert.ok(button('Download APK'), 'A retry error preserves the available update');
  response = { opened: true }; await click('Download APK');
  assert.equal(requests.at(-1), 'downloadUpdate');
  assert.match(text(), /download opened in your browser/);
  response = { currentVersion: '0.1.0-beta.4.1', update: null }; await click('Check for updates');
  assert.match(text(), /up to date/); assert.equal(button('Download APK'), undefined);
  response = { active: false, supported: true, roleAvailable: true, settingsAvailable: true, sdk: 36 };
  await act(async () => render(AndroidAssistantSetup));
  assert.equal(requests.at(-1), 'status');
  response = { opened: true }; await click('Open assistant setup');
  assert.equal(requests.at(-1), 'setup');
  assert.match(text(), /open Digital assistant app and choose Alfred/);
  response = { opened: false }; await click('Open assistant setup');
  assert.match(text(), /Could not open Android settings/);
  assert.equal(button('Open assistant setup')?.disabled, false, 'Failed setup can be retried');
  response = { error: 'Android denied this settings action' }; await click('Open assistant setup');
  assert.match(text(), /Android denied this settings action/);
  response = { active: true, supported: true, roleAvailable: true, settingsAvailable: true, sdk: 36 };
  await act(async () => window.dispatchEvent(new Event('focus')));
  assert.match(text(), /Alfred is your active assistant/, 'Returning from Settings refreshes assistant selection');
  const { WelcomeScreen } = await server.ssrLoadModule('/src/components/reliability/WelcomeScreen.tsx');
  const originalAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  try {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android' });
    await act(async () => root.render(createElement(WelcomeScreen, { guest() {}, google() {} })));
    assert.ok(document.querySelector('.welcome-screen.is-android'), 'Android welcome uses safe viewport centering');
    assert.ok(button('Continue as guest')); assert.ok(button('Continue with Google'));
    await act(async () => root.render(createElement(WelcomeScreen, { guest() {}, google() {}, embedded: true })));
    assert.ok(document.querySelector('.welcome-embedded'));
    assert.equal(document.querySelector('.welcome-screen.is-android'), null, 'Embedded previews keep their own sizing');
  } finally {
    if (originalAgent) Object.defineProperty(navigator, 'userAgent', originalAgent); else Reflect.deleteProperty(navigator, 'userAgent');
  }
  console.log('PASS: Android update flow, assistant setup success/failure/retry/status refresh and welcome viewport modes.');
} finally {
  await act(async () => root.unmount());
  await server.close(); await dom.happyDOM.abort();
  for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
