/* Browser-only history and timers. No credentials in browser storage. */
const element = id => document.getElementById(id);
const history = [];
let timer, controller, busy = false, authenticated = false, verified = false;
const bytes = n => n == null ? 'Unavailable' : `${(n / 1048576).toFixed(1)} MB`;
const duration = n => `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m`;
function notice(text) { element('notice').textContent = text; }
async function request(path, body, signal) {
  const response = await fetch(`/monitor/${path}`, { credentials: 'same-origin', cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return data;
}
function card(title, value, detail, bad = false) {
  const node = document.createElement('article'); node.className = 'card';
  const heading = document.createElement('h2'); heading.textContent = title;
  const number = document.createElement('div'); number.className = `value ${bad ? 'bad' : 'ok'}`; number.textContent = value;
  const description = document.createElement('p'); description.className = 'detail'; description.textContent = detail;
  node.append(heading, number, description); element('cards').append(node);
}
function render(data) {
  const { server: s, traffic: t, atlas: a } = data;
  element('cards').replaceChildren();
  card('Backend', data.backend.status, `Uptime ${duration(s.process.uptimeSeconds)} · ${data.mode}\nRevision ${(data.backend.revision || 'unknown').slice(0, 20)}`, data.backend.status !== 'healthy');
  card('Active accounts · 5 minutes', String(t.activeAccounts5m), `${t.accountsMakingRequests} accounts making requests\n${t.inFlight} requests currently running`);
  card('Backend RAM', bytes(s.process.rssBytes), `Node heap ${bytes(s.process.heapUsedBytes)} / ${bytes(s.process.heapTotalBytes)}`);
  card('Server RAM', bytes(s.host.totalMemoryBytes - s.host.freeMemoryBytes), `${bytes(s.host.freeMemoryBytes)} free / ${bytes(s.host.totalMemoryBytes)} total\nIncludes OS cache; host values exposed by OS.`);
  card('Container RAM', bytes(s.container.memoryBytes), `Limit ${s.container.memoryLimitBytes == null ? 'not reported / unlimited' : bytes(s.container.memoryLimitBytes)}`);
  card('Backend filesystem', bytes(s.filesystem?.usedBytes), `${bytes(s.filesystem?.availableBytes)} available / ${bytes(s.filesystem?.totalBytes)} total\nFilesystem containing the backend; excludes Atlas.`);
  card('Server load · 1 / 5 / 15 min', s.host.loadAverage.map(n => n.toFixed(2)).join(' / '), `${s.host.logicalCpus} logical CPUs\nBackend CPU time ${s.process.cpuSeconds.toFixed(1)} seconds since startup`);
  card('Previous full minute', `${t.previousMinute.requests} requests`, `${t.previousMinute.errors} server errors\nAverage latency ${t.previousMinute.averageLatencyMs == null ? 'no samples' : `${t.previousMinute.averageLatencyMs} ms`}`);
  card('Atlas application database', a.status === 'ok' ? bytes(a.dataBytes) : 'Unavailable', a.status === 'ok' ? `Allocated documents ${bytes(a.storageBytes)}\nIndexes ${bytes(a.indexBytes)} · ${a.latencyMs} ms\n${a.scope}` : a.detail || 'Database disconnected', a.status !== 'ok');
  element('services').replaceChildren();
  for (const [name, service] of Object.entries(data.services)) {
    const node = document.createElement('article'), title = document.createElement('h3'); title.textContent = name === 'ai' ? 'AI provider' : name[0].toUpperCase() + name.slice(1);
    const status = document.createElement('p'); status.textContent = `${service.status}${service.latencyMs == null ? '' : ` · ${service.latencyMs} ms`}`;
    const detail = document.createElement('p'); detail.textContent = [service.provider, service.model, service.detail].filter(Boolean).join(' · ');
    const last = document.createElement('p'); last.textContent = service.lastRequest ? `Last request ${service.lastRequest.ok ? 'succeeded' : 'failed'} · ${new Date(service.lastRequest.at).toLocaleString()} · ${service.lastRequest.latencyMs} ms` : 'No real request observed since startup.';
    node.append(title, status, detail); if ('lastRequest' in service) node.append(last); element('services').append(node);
  }
  if (history.at(-1)?.at !== data.sampledAt) history.push({ at: data.sampledAt, ram: s.process.rssBytes, active: t.activeAccounts5m });
  if (history.length > 60) history.shift();
  const max = Math.max(...history.map(p => p.ram), 1); element('history').replaceChildren();
  for (const point of history) { const bar = document.createElement('div'); bar.className = 'bar'; bar.style.height = `${Math.max(3, point.ram / max * 100)}%`; bar.title = `${new Date(point.at).toLocaleTimeString()} · ${bytes(point.ram)} RAM · ${point.active} active accounts`; element('history').append(bar); }
  element('timestamp').textContent = `Sampled ${new Date(data.sampledAt).toLocaleString()}`;
}
function stop() { clearTimeout(timer); controller?.abort(); }
async function refresh() {
  if (document.hidden || busy) return;
  clearTimeout(timer); busy = true; element('refresh').disabled = true;
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const data = await request('metrics', null, controller.signal); authenticated = true;
    element('login').hidden = true; element('dashboard').hidden = false; element('logout').hidden = false;
    render(data); notice('Monitoring active · refreshes every 30 seconds while visible.');
  } catch (error) {
    if (error.status === 401) { authenticated = false; element('dashboard').hidden = true; element('logout').hidden = true; element('login').hidden = false; notice('Admin sign-in required.'); }
    else if (!document.hidden) notice('Unable to refresh. Displayed metrics are stale; retrying while this tab is visible.');
  } finally {
    clearTimeout(timeout); busy = false; element('refresh').disabled = false;
    if (authenticated && !document.hidden) timer = setTimeout(refresh, 30000);
  }
}
element('password-form').addEventListener('submit', async event => {
  event.preventDefault(); element('submit').disabled = true;
  try { await request(verified ? 'password' : 'login', { password: element('password').value }); element('password').value = ''; await refresh(); }
  catch (error) { notice(error.message); }
  finally { element('submit').disabled = false; }
});
element('logout').addEventListener('click', async () => {
  stop(); try { await request('logout', {}); authenticated = false; history.length = 0; element('dashboard').hidden = true; element('logout').hidden = true; element('login').hidden = false; notice('Signed out.'); }
  catch { notice('Sign-out failed. Please retry.'); }
});
element('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); notice('Monitoring paused while this tab is hidden.'); } else refresh(); });
window.addEventListener('pagehide', stop);
async function start() {
  try {
    const state = await request('auth-state'); verified = state.verified;
    if (verified) { element('submit').textContent = 'Set password and sign in'; element('password').autocomplete = 'new-password'; element('setup-copy').textContent = 'Google ownership verified. Choose a new password with 12–128 characters. This replaces any previous dashboard password.'; }
    if (new URLSearchParams(location.search).has('error')) element('setup-copy').textContent = 'Google verification failed. Use singhshashwat.dev@gmail.com and retry verification.';
    window.history.replaceState(null, '', '/monitor');
    await refresh();
  } catch { element('login').hidden = false; notice('Unable to reach the admin service. Reload to retry.'); }
}
start();
