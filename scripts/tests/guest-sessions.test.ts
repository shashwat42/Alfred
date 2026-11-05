import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { test } from "node:test";
import { AUTH_STORAGE_KEY, GUEST_CHOICE_KEY, RECOVERABLE_SESSIONS_KEY, clearPendingDesktopAuth, createGuestSession, exchangeTicket, getPendingDesktopAuth, getSession, initAuthSession, logoutToGuest, renewGuestSession, restoreAuthSession, savePendingDesktopAuth } from "../../src/auth/auth.ts";
import { apiFetch } from "../../src/lib/api.ts";

const originalFetch = globalThis.fetch;
test("first launch waits for a choice without creating a guest or contacting the backend", async () => {
  values.clear(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected first-launch request"); };
  try {
    assert.deepEqual(await Promise.all([initAuthSession(false), initAuthSession(false)]), [null, null]);
    assert.equal(calls, 0); assert.equal(getSession(), null);
  } finally { globalThis.fetch = originalFetch; values.clear(); }
});
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { search: "", hash: "", pathname: "/" }, dispatchEvent: () => true } });
const guest = { token: "expired-guest-token", account: { id: "canonical-guest", type: "guest" as const } };
const saveGuest = () => { values.clear(); values.set(`alfred_cloud_sync_${guest.account.id}`, "true"); values.set(AUTH_STORAGE_KEY, JSON.stringify(guest)); };

test("startup verifies saved guests and renews the same canonical account without Google", async () => {
  saveGuest(); const calls: string[] = [];
  globalThis.fetch = async url => { calls.push(String(url)); return String(url).endsWith("/auth/session") ? Response.json({}, { status: 401 }) : Response.json({ ...guest, token: "renewed-token" }); };
  try {
    const result = await initAuthSession(false);
    assert.equal(result?.account.id, guest.account.id); assert.equal(getSession()?.token, "renewed-token");
    assert.deepEqual(calls.map(url => new URL(url).pathname), ["/auth/session", "/auth/guest/renew"]);
  } finally { globalThis.fetch = originalFetch; values.clear(); }
});
test("parallel unauthorized requests share guest renewal and retry once with the same owner", async () => {
  saveGuest(); let renewals = 0, creates = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/auth/guest/renew")) { renewals++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ ...guest, token: "renewed-token" }); }
    if (String(url).endsWith("/auth/guest")) creates++;
    return new Headers(init?.headers).get("Authorization") === "Bearer renewed-token" ? Response.json([]) : Response.json({}, { status: 401 });
  };
  try {
    const responses = await Promise.all([apiFetch("/api/tasks"), apiFetch("/api/notes")]);
    assert.ok(responses.every(response => response.ok)); assert.equal(renewals, 1); assert.equal(creates, 0);
    assert.equal(getSession()?.account.id, guest.account.id);
  } finally { globalThis.fetch = originalFetch; values.clear(); }
});
test("unrecoverable credentials remain saved and unauthorized requests cannot loop", async () => {
  saveGuest(); const calls: string[] = [];
  globalThis.fetch = async url => { calls.push(String(url)); return Response.json({}, { status: 401 }); };
  try {
    assert.equal((await apiFetch("/api/tasks")).status, 401); assert.equal(calls.length, 2);
    assert.equal(getSession()?.token, guest.token); assert.ok(calls.every(url => !url.endsWith("/auth/guest")));
  } finally { globalThis.fetch = originalFetch; values.clear(); }
});
test("explicit guest continuation preserves the old credential and failed creation does not clear it", async () => {
  saveGuest(); globalThis.fetch = async () => Response.json({}, { status: 503 });
  try {
    await assert.rejects(createGuestSession(true), /temporarily unavailable/); assert.equal(getSession()?.token, guest.token);
    globalThis.fetch = async () => Response.json({ token: "new-guest-token", account: { id: "new-guest", type: "guest" } });
    await createGuestSession(true);
    assert.equal(getSession()?.account.id, "new-guest");
    assert.equal(JSON.parse(values.get(RECOVERABLE_SESSIONS_KEY)!)[guest.account.id].token, guest.token);
  } finally { globalThis.fetch = originalFetch; values.clear(); }
});
test("backend outages preserve existing credentials without starting another account", async () => {
  saveGuest(); globalThis.fetch = async () => Response.json({}, { status: 503 });
  try { await assert.rejects(restoreAuthSession(guest), /temporarily unavailable/); assert.equal(getSession()?.token, guest.token); }
  finally { globalThis.fetch = originalFetch; values.clear(); }
});
test("late guest renewal cannot overwrite an account switch", async () => {
  saveGuest(); globalThis.fetch = async () => { values.set(AUTH_STORAGE_KEY, JSON.stringify({ token: "other", account: { id: "other-account", type: "user" } })); return Response.json({ ...guest, token: "renewed-token" }); };
  try { await assert.rejects(renewGuestSession(guest), /account changed/); assert.equal(getSession()?.account.id, "other-account"); }
  finally { globalThis.fetch = originalFetch; values.clear(); }
});

test("logout starts one fresh confirmed guest and cancels pending Google sign-in", async () => {
  saveGuest(); values.set(GUEST_CHOICE_KEY, guest.account.id); savePendingDesktopAuth("old-login", "verifier");
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path === "/auth/logout") { assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${guest.token}`); return Response.json({ ok: true }); }
    if (path === "/auth/guest") return Response.json({ token: "fresh", account: { id: "fresh-guest", type: "guest" } });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const first = logoutToGuest(), second = logoutToGuest();
    assert.equal(first, second, "Duplicate clicks share the logout transition");
    await first;
    assert.equal(getSession()?.account.id, "fresh-guest");
    assert.equal(values.get(GUEST_CHOICE_KEY), "fresh-guest");
    assert.equal(getPendingDesktopAuth(), null);
    assert.deepEqual(calls, ["/auth/logout", "/auth/guest"]);
  } finally { globalThis.fetch = originalFetch; clearPendingDesktopAuth(); values.clear(); }
});

test("failed sign-out preserves the current account and never creates a guest", async () => {
  saveGuest(); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}, { status: 503 }); };
  try { await assert.rejects(logoutToGuest(), /Sign-out failed/); assert.equal(getSession()?.token, guest.token); assert.equal(calls, 1); }
  finally { globalThis.fetch = originalFetch; values.clear(); }
});

test("failed fresh guest creation after sign-out never restores an old guest", async () => {
  saveGuest(); values.set(GUEST_CHOICE_KEY, guest.account.id);
  globalThis.fetch = async url => Response.json({}, { status: String(url).endsWith("/auth/logout") ? 200 : 503 });
  try { await assert.rejects(logoutToGuest(), /Guest access/); assert.equal(getSession(), null); assert.equal(values.has(GUEST_CHOICE_KEY), false); }
  finally { globalThis.fetch = originalFetch; values.clear(); }
});

test("a delayed sign-out response cannot replace a switched Google account", async () => {
  saveGuest();
  globalThis.fetch = async () => { values.set(AUTH_STORAGE_KEY, JSON.stringify({ token: "other-user", account: { id: "other", type: "user" } })); return Response.json({ ok: true }); };
  try { await assert.rejects(logoutToGuest(), /account changed/); assert.equal(getSession()?.token, "other-user"); }
  finally { globalThis.fetch = originalFetch; values.clear(); }
});

test("a late Google handoff cannot restore the user after a new guest starts", async () => {
  saveGuest(); savePendingDesktopAuth("old-state", "verifier");
  globalThis.fetch = async () => {
    clearPendingDesktopAuth();
    values.set(AUTH_STORAGE_KEY, JSON.stringify({ token: "fresh", account: { id: "fresh-guest", type: "guest" } }));
    return Response.json({ token: "late-google", account: { id: "google-account", type: "user" } });
  };
  try { await assert.rejects(exchangeTicket("old-ticket", "verifier"), /account changed/); assert.equal(getSession()?.account.id, "fresh-guest"); }
  finally { globalThis.fetch = originalFetch; clearPendingDesktopAuth(); values.clear(); }
});
