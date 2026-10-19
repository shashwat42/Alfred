import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const dom = new Window({ url: 'http://localhost:5173/' });
const names = ['window', 'document', 'navigator', 'localStorage', 'CustomEvent', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom[name as keyof Window] });
const server = await createServer({ mode: 'development', cacheDir: 'node_modules/.vite-timezone-tests', optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { createRoot } = await import('react-dom/client');
document.body.innerHTML = '<div id="root"></div>';
const root = createRoot(document.getElementById('root')!);
const originalFetch = globalThis.fetch;
const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
let deviceZone = 'Asia/Kolkata';
Intl.DateTimeFormat.prototype.resolvedOptions = function () { return { ...resolvedOptions.call(this), timeZone: deviceZone }; };
let preferences = { destination: 'both', enabled: true, leadMinutes: 10, atStart: false, timeZone: 'UTC', timeZoneMode: undefined as string | undefined, revision: 1 };
const writes: typeof preferences[] = [];
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).endsWith('/api/schedule-notifications/preferences'));
  if (init?.method === 'PUT') {
    const body = JSON.parse(String(init.body));
    assert.equal(body.revision, preferences.revision);
    preferences = { ...body, revision: body.revision + 1 };
    writes.push(preferences);
  }
  return Response.json(preferences);
};
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
try {
  const { AuthContext } = await server.ssrLoadModule('/src/auth/authContext.ts');
  const { ScheduleNotificationSettings } = await server.ssrLoadModule('/src/components/dashboard/ScheduleNotificationSettings.tsx');
  const session = { token: 'isolated-test-token', account: { id: '111111111111111111111111', type: 'user' } };
  localStorage.setItem('alfred_session', JSON.stringify(session));
  await act(async () => root.render(createElement(AuthContext.Provider, { value: { session, requiresAccountChoice: false } }, createElement(ScheduleNotificationSettings))));
  await settle();
  const zone = () => document.querySelector<HTMLSelectElement>('#schedule-notification-zone')!;
  assert.equal(zone().value, 'automatic');
  assert.match(zone().selectedOptions[0].textContent!, /Asia\/Kolkata/);
  assert.equal(preferences.timeZone, 'Asia/Kolkata');
  const choose = async (value: string) => act(async () => { zone().value = value; zone().dispatchEvent(new dom.Event('change', { bubbles: true })); });
  await choose('UTC');
  assert.equal(preferences.timeZoneMode, 'manual');
  assert.equal(zone().value, 'UTC');
  const count = writes.length;
  deviceZone = 'America/New_York';
  await act(async () => window.dispatchEvent(new dom.Event('focus')));
  await settle();
  assert.equal(writes.length, count, 'Device changes cannot overwrite an explicit zone');
  assert.equal(zone().value, 'UTC');
  await choose('automatic');
  assert.equal(preferences.timeZone, 'America/New_York');
  assert.equal(preferences.timeZoneMode, 'automatic');
  deviceZone = 'Asia/Kolkata';
  await act(async () => window.dispatchEvent(new dom.Event('focus')));
  await settle();
  assert.equal(preferences.timeZone, 'Asia/Kolkata');
  assert.equal(preferences.destination, 'both');
  assert.equal(preferences.leadMinutes, 10);
  console.log('PASS: Settings detects IST, persists automatic timing, respects manual UTC, and follows device zone changes when automatic.');
} finally {
  await act(async () => root.unmount());
  await server.close(); await dom.happyDOM.abort();
  globalThis.fetch = originalFetch;
  Intl.DateTimeFormat.prototype.resolvedOptions = resolvedOptions;
  for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
