// Mock localStorage and window with strict typing
const store: Record<string, string> = {};
const mockLocalStorage: Storage = {
  getItem: (key: string): string | null => store[key] ?? null,
  setItem: (key: string, val: string): void => {
    store[key] = val;
  },
  removeItem: (key: string): void => {
    delete store[key];
  },
  clear: (): void => {
    for (const k of Object.keys(store)) delete store[k];
  },
  key: (index: number): string | null => Object.keys(store)[index] ?? null,
  get length(): number {
    return Object.keys(store).length;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

Object.defineProperty(globalThis, "window", {
  value: {
    location: { href: "" },
  },
  writable: true,
});

import {
  getSession,
  clearSession,
  getToken,
  createGuestSession,
  initAuthSession,
  loginWithGoogle,
  AUTH_STORAGE_KEY,
} from "./src/auth/auth.ts";
import { apiFetch } from "./src/lib/api.ts";

async function runTests(): Promise<void> {
  console.log("--- Starting Frontend Auth Tests ---");

  // 1. Initial State
  clearSession();
  console.assert(getSession() === null, "Initial getSession() should be null");
  console.assert(getToken() === null, "Initial getToken() should be null");
  console.log("✓ Initial state null check passed");

  // 2. Create Guest Session against live backend
  const guestSession = await createGuestSession();
  console.assert(!!guestSession.token, "Guest session token must exist");
  console.assert(guestSession.account.type === "guest", "Account type must be guest");
  console.assert(!!guestSession.account.id, "Account id must exist");
  console.assert(
    localStorage.getItem(AUTH_STORAGE_KEY) !== null,
    "Storage key alfred_session must be populated"
  );
  console.log("✓ Guest session creation passed:", {
    accountId: guestSession.account.id,
    accountType: guestSession.account.type,
    tokenPrefix: guestSession.token.slice(0, 15) + "...",
  });

  // 3. Restore session (simulating page reload)
  const restoredSession = getSession();
  console.assert(
    restoredSession?.token === guestSession.token,
    "Restored session token must match"
  );
  console.assert(
    restoredSession?.account.id === guestSession.account.id,
    "Restored account id must match"
  );
  console.log("✓ Session restoration from localStorage passed");

  // 4. initAuthSession idempotency (should restore rather than create another)
  const initResult = await initAuthSession();
  console.assert(
    initResult.account.id === guestSession.account.id,
    "initAuthSession must restore existing session rather than create a new one"
  );
  console.log("✓ initAuthSession idempotency passed");

  // 5. Test apiFetch with Bearer token
  let capturedAuthHeader: string | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    capturedAuthHeader = headers.get("Authorization");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  await apiFetch("/api/tasks");
  console.assert(
    capturedAuthHeader === `Bearer ${guestSession.token}`,
    `Expected Bearer ${guestSession.token}, got ${capturedAuthHeader}`
  );
  console.log("✓ apiFetch Bearer token injection passed");
  globalThis.fetch = originalFetch;

  // 6. Test loginWithGoogle
  loginWithGoogle();
  const currentHref = (globalThis.window as { location: { href: string } }).location.href;
  console.assert(
    currentHref === "http://localhost:8000/auth/google",
    "loginWithGoogle must redirect to backend auth URL"
  );
  console.log("✓ loginWithGoogle redirect URL passed");

  // 7. Clear session
  clearSession();
  console.assert(getSession() === null, "getSession() after clearSession must be null");
  console.assert(getToken() === null, "getToken() after clearSession must be null");
  console.log("✓ clearSession passed");

  console.log("--- All Tests Passed Successfully! ---");
}

runTests().catch((err: unknown) => {
  console.error("Test failed:", err);
  process.exit(1);
});
