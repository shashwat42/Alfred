export type AuthSession = {
  token: string;
  account: {
    id: string;
    type: "guest" | "user";
    guestId?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
};

export const AUTH_STORAGE_KEY = "alfred_session";
export const GUEST_CHOICE_KEY = "alfred_guest_choice_account";

export function confirmedGuestAccount(): string | null {
  try { return localStorage.getItem(GUEST_CHOICE_KEY); } catch { return null; }
}

export function confirmGuestAccount(session: AuthSession): void {
  if (session.account.type !== "guest") throw new Error("A guest session is required.");
  localStorage.setItem(GUEST_CHOICE_KEY, session.account.id);
}
export const RECOVERABLE_SESSIONS_KEY = "alfred_recoverable_sessions";
export const AUTH_INVALID_EVENT = "alfred_auth_invalid";
export const PENDING_DESKTOP_AUTH_KEY = "alfred_pending_desktop_auth";
export const RETURN_URL_STORAGE_KEY = "alfred_auth_return_url";
export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL)
    ? import.meta.env.VITE_API_BASE_URL
    : "http://localhost:8000";

export type AuthCallback = (session: AuthSession | null) => void;

let memoryAuthCallback: AuthCallback | null = null;

export function setAuthCompletionCallback(callback: AuthCallback | null): void {
  memoryAuthCallback = callback;
}

export function triggerAuthCompletionCallback(session: AuthSession | null): void {
  if (memoryAuthCallback) {
    const cb = memoryAuthCallback;
    memoryAuthCallback = null;
    try {
      cb(session);
    } catch (err) {
      console.error("Error executing auth completion callback:", err);
    }
  }
}

export function saveReturnLocation(): void {
  if (typeof window !== "undefined" && window.location) {
    try {
      const currentLoc = window.location.pathname + window.location.search + window.location.hash;
      sessionStorage.setItem(RETURN_URL_STORAGE_KEY, currentLoc);
    } catch {
      // Ignore storage restrictions
    }
  }
}

export function getAndClearReturnLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const returnLoc = sessionStorage.getItem(RETURN_URL_STORAGE_KEY);
    if (returnLoc) {
      sessionStorage.removeItem(RETURN_URL_STORAGE_KEY);
      return returnLoc;
    }
  } catch {
    // Ignore
  }
  return null;
}

import { isTauri as checkTauri } from "@tauri-apps/api/core";

/**
 * Checks whether the application is running inside a Tauri native desktop WebView.
 */
export function isTauri(): boolean {
  try {
    if (checkTauri()) return true;
  } catch {
    // fallback if core check throws
  }
  if (typeof window !== "undefined") {
    const win = window as unknown as { isTauri?: boolean; __TAURI_INTERNALS__?: unknown };
    return Boolean(win.isTauri || win.__TAURI_INTERNALS__);
  }
  return false;
}

/**
 * Retrieves the persisted session from localStorage.
 * Returns null if no session exists or if the stored session is invalid.
 */
export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      typeof parsed?.token === "string" &&
      parsed.token.length > 0 &&
      parsed.account &&
      typeof parsed.account.id === "string" &&
      (parsed.account.type === "guest" || parsed.account.type === "user")
    ) {
      return parsed as AuthSession;
    }

    clearSession();
    return null;
  } catch (error) {
    console.error("Failed to parse auth session from localStorage:", error);
    clearSession();
    return null;
  }
}

export const AUTH_CHANGE_EVENT = "alfred_auth_change";

export function dispatchAuthChange(session: AuthSession | null): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: session }));
    } catch {
      // In non-browser environments, safely ignore
    }
  }
}

/**
 * Stores the given session in localStorage.
 */
export function setSession(session: AuthSession): void {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    dispatchAuthChange(session);
  } catch (error) {
    console.error("Failed to persist auth session to localStorage:", error);
  }
}

let cachedTicket: string | null = null;
let cachedAuthError: string | null = null;
let hasCheckedUrl = false;
let inFlightInitPromise: Promise<AuthSession | null> | null = null;

/**
 * Removes the auth session from localStorage.
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    cachedTicket = null;
    cachedAuthError = null;
    hasCheckedUrl = false;
    inFlightInitPromise = null;
    dispatchAuthChange(null);
  } catch (error) {
    console.error("Failed to remove auth session from localStorage:", error);
  }
}

/**
 * Retrieves the current session token or null if unauthenticated.
 */
export function getToken(): string | null {
  return getSession()?.token ?? null;
}

/**
 * Requests a new guest session from the backend.
 * Preserves existing credentials on failure. Replacing an existing session is
 * an explicit action and archives its credential before selecting the new guest.
 */
export async function createGuestSession(replaceExisting = false): Promise<AuthSession> {
    const previous = getSession();
    if (previous && !replaceExisting) throw new Error("An existing session must be restored before starting another guest account.");
    const response = await fetch(`${API_BASE_URL}/auth/guest`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
    });

    if (!response.ok) {
      throw new Error("Guest access is temporarily unavailable. Please retry; Google sign-in is optional.");
    }

    const sessionData = (await response.json()) as AuthSession;
    if (!sessionData?.token || !sessionData?.account?.id) {
      throw new Error("Invalid guest session data received from server");
    }
    if (getSession()?.token !== previous?.token) throw new Error("Your account changed. Please try again.");
    // Explicit guest continuation preserves the original credential and server
    // data. Never erase it just because restoration or the network failed.
    if (previous) {
      const recoverable = JSON.parse(localStorage.getItem(RECOVERABLE_SESSIONS_KEY) || "{}") as Record<string, AuthSession>;
      recoverable[previous.account.id] = previous;
      localStorage.setItem(RECOVERABLE_SESSIONS_KEY, JSON.stringify(recoverable));
    }
    setSession(sessionData);
    return sessionData;
}

export class SessionRecoveryError extends Error {
  status = 401;
}

const guestRenewals = new Map<string, Promise<AuthSession>>();
export function renewGuestSession(expected: AuthSession): Promise<AuthSession> {
  const current = getSession();
  if (current?.account.id !== expected.account.id || current.account.type !== "guest") return Promise.reject(new Error("Your account changed. Please try again."));
  if (current.token !== expected.token) return Promise.resolve(current);
  const pending = guestRenewals.get(expected.token);
  if (pending) return pending;
  const renewal = (async () => {
    const response = await fetch(`${API_BASE_URL}/auth/guest/renew`, { method: "POST", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${expected.token}`, "ngrok-skip-browser-warning": "true" } });
    if (response.status === 401) throw new SessionRecoveryError("Your saved guest session could not be restored. Continue as a new guest; no sign-in is required. Existing data is kept.");
    if (!response.ok) throw new Error("Guest session recovery is temporarily unavailable. Please retry.");
    const renewed = await response.json() as AuthSession;
    if (!renewed.token || renewed.account?.id !== expected.account.id || renewed.account.type !== "guest") throw new Error("The server returned an invalid guest renewal.");
    if (getSession()?.token !== expected.token) throw new Error("Your account changed. Please try again.");
    setSession(renewed);
    return renewed;
  })().finally(() => guestRenewals.delete(expected.token));
  guestRenewals.set(expected.token, renewal);
  return renewal;
}

export function reportInvalidSession(token: string): void {
  const current = getSession();
  if (current?.token !== token || typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: current.account.type === "guest"
    ? "Your guest session needs recovery. You can continue without Google sign-in."
    : "Your saved session needs recovery. Continue as a guest, or sign in with Google to return to your account." }));
}

export async function restoreAuthSession(existing: AuthSession): Promise<AuthSession> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/session`, { signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${existing.token}`, "ngrok-skip-browser-warning": "true" } });
  } catch (error) {
    const { cloudSyncEnabled } = await import("../lib/localWorkspace.ts");
    if (!cloudSyncEnabled(existing.account.id) && getSession()?.token === existing.token) return existing;
    throw error;
  }
  if (response.status === 401) {
    if (existing.account.type === "guest") return renewGuestSession(existing);
    throw new SessionRecoveryError("Your saved session needs recovery. You can continue as a guest without signing in, or use Google to return to your account.");
  }
  if (!response.ok) {
    const { cloudSyncEnabled } = await import("../lib/localWorkspace.ts");
    if (response.status >= 500 && !cloudSyncEnabled(existing.account.id) && getSession()?.token === existing.token) return existing;
    throw new Error("Alfred is temporarily unavailable. Retry when the connection is restored.");
  }
  const restored = await response.json() as AuthSession;
  if (!restored.token || restored.account?.id !== existing.account.id || restored.account.type !== existing.account.type) throw new Error("The server returned an invalid session.");
  if (getSession()?.token !== existing.token) throw new Error("Your account changed. Please try again.");
  setSession(restored);
  return restored;
}

/**
 * Generates cryptographically secure base64url random string for PKCE and state.
 */
export function generateRandomString(byteLength = 32): string {
  const buffer = new Uint8Array(byteLength);
  crypto.getRandomValues(buffer);
  const binary = String.fromCharCode(...buffer);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Computes S256 code challenge from code_verifier via Web Crypto API.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PendingDesktopAuth {
  sourceAccountId?: string;
  state: string;
  codeVerifier: string;
  expiresAt: number;
}

export class DesktopAuthCancelledError extends Error {
  constructor() { super("Google sign-in was cancelled. You can try again anytime."); this.name = "DesktopAuthCancelledError"; }
}

let memoryPendingAuth: PendingDesktopAuth | null = null;

export function savePendingDesktopAuth(state: string, codeVerifier: string): void {
  const pending: PendingDesktopAuth = {
    sourceAccountId: getSession()?.account.id,
    state,
    codeVerifier,
    expiresAt: Date.now() + 120_000, // Strict 2-minute lifetime
  };
  memoryPendingAuth = pending;
  try {
    localStorage.setItem(PENDING_DESKTOP_AUTH_KEY, JSON.stringify(pending));
  } catch {
    // In restricted storage environments, keep memory copy
  }
}

export function getPendingDesktopAuth(): PendingDesktopAuth | null {
  if (memoryPendingAuth) {
    if (Date.now() <= memoryPendingAuth.expiresAt) {
      return memoryPendingAuth;
    }
    clearPendingDesktopAuth();
    return null;
  }

  try {
    const raw = localStorage.getItem(PENDING_DESKTOP_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingDesktopAuth>;
    if (
      typeof parsed?.state === "string" &&
      typeof parsed?.codeVerifier === "string" &&
      typeof parsed?.expiresAt === "number"
    ) {
      if (Date.now() <= parsed.expiresAt) {
        memoryPendingAuth = parsed as PendingDesktopAuth;
        return memoryPendingAuth;
      }
    }
  } catch {
    // Ignore parse error and wipe below
  }

  clearPendingDesktopAuth();
  return null;
}

export function clearPendingDesktopAuth(): void {
  memoryPendingAuth = null;
  try {
    localStorage.removeItem(PENDING_DESKTOP_AUTH_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Exchanges a short-lived, one-time OAuth handoff ticket for an authenticated Alfred session.
 * Supports optional PKCE code_verifier for desktop authorization handoff.
 */
export async function exchangeTicket(ticket: string, codeVerifier?: string, expectedState?: string): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({
      ticket,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Authentication handoff failed (${response.status}): ${errorBody}`);
  }

  const sessionData = (await response.json()) as AuthSession;
  if (!sessionData?.token || !sessionData?.account?.id) {
    throw new Error("Invalid session data received from server handoff");
  }

  if (expectedState && getPendingDesktopAuth()?.state !== expectedState) throw new Error("This sign-in attempt was replaced. Please use the latest Google sign-in window.");
  await migrateLocalGuest(sessionData);
  setSession(sessionData);
  return sessionData;
}

async function migrateLocalGuest(target: AuthSession): Promise<void> {
  const current = getSession();
  if (current?.account.type !== "guest" || current.account.id === target.account.id || getPendingDesktopAuth()?.sourceAccountId !== current.account.id) return;
  const { copyGuestWorkspace } = await import("../lib/localWorkspace.ts");
  await copyGuestWorkspace(current.account.id, target.account.id);
}

/**
 * Checks the URL query string for OAuth handoff ticket or error parameters.
 * Caches and immediately strips sensitive query parameters from the browser URL.
 */
export function checkUrlAuthParameters(): { ticket: string | null; authError: string | null } {
  if (hasCheckedUrl) {
    return { ticket: cachedTicket, authError: cachedAuthError };
  }

  if (
    typeof window === "undefined" ||
    !window.location ||
    typeof window.location.search !== "string"
  ) {
    return { ticket: null, authError: null };
  }

  const searchParams = new URLSearchParams(window.location.search);
  cachedTicket = searchParams.get("ticket");
  cachedAuthError = searchParams.get("auth_error");
  hasCheckedUrl = true;

  if (cachedTicket || cachedAuthError) {
    searchParams.delete("ticket");
    searchParams.delete("auth_error");
    const cleanSearch = searchParams.toString();
    const newRelativePath =
      window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState({}, document.title, newRelativePath);
  }

  return { ticket: cachedTicket, authError: cachedAuthError };
}

/**
 * Initializes authentication state at application startup.
 * Deduplicated via a shared in-flight promise to prevent StrictMode race conditions.
 * 1. Checks for OAuth ticket or error in URL.
 * 2. Restores an existing session if valid.
 * 3. Creates a guest session if unauthenticated, unless the main welcome screen
 *    asks to defer creation until the user chooses guest or Google.
 */
export function initAuthSession(createGuest: false): Promise<AuthSession | null>;
export function initAuthSession(createGuest?: true): Promise<AuthSession>;
export function initAuthSession(createGuest = true): Promise<AuthSession | null> {
  if (inFlightInitPromise) {
    return inFlightInitPromise.then(session => session ?? (createGuest ? createGuestSession() : null));
  }

  inFlightInitPromise = Promise.resolve().then(async () => {
    try {
      const { ticket, authError } = checkUrlAuthParameters();

      if (authError) {
        console.warn("OAuth parameter error encountered during initialization:", authError);
      }

      if (ticket) {
        try {
          const pending = getPendingDesktopAuth();
          if (!pending) throw new Error("Missing login verifier");
          const session = await exchangeTicket(ticket, pending.codeVerifier);
          clearPendingDesktopAuth();
          cachedTicket = null;
          triggerAuthCompletionCallback(session);
          const returnLoc = getAndClearReturnLocation();
          if (returnLoc && typeof window !== "undefined" && window.location) {
            const currentLoc = window.location.pathname + window.location.search + window.location.hash;
            if (returnLoc !== currentLoc && returnLoc !== "/") {
              window.history.replaceState({}, document.title, returnLoc);
            }
          }
          return session;
        } catch (err) {
          cachedTicket = null;
          throw err;
        }
      }

      if (isTauri()) {
        try {
          const { getCurrent } = await import("@tauri-apps/plugin-deep-link");
          const urls = await getCurrent();
          if (urls && urls.length > 0) {
            for (const url of urls) {
              if (url.startsWith("alfred://auth/callback")) {
                const session = await handleDesktopDeepLink(url);
                if (session) {
                  triggerAuthCompletionCallback(session);
                  return session;
                }
              }
            }
          }
        } catch (err) {
          console.warn("Failed to check cold-start deep link:", err);
        }
      }

      const existingSession = getSession();
      if (existingSession) {
        return await restoreAuthSession(existingSession);
      }

      return createGuest ? await createGuestSession() : null;
    } finally {
      inFlightInitPromise = null;
    }
  });

  return inFlightInitPromise;
}

/**
 * Initiates Google OAuth login.
 * On desktop (Tauri): generates PKCE challenge & state, stores verifier, and launches external system browser.
 * On browser: redirects current window to backend Google auth endpoint.
 */
export async function loginWithGoogle(callback?: AuthCallback): Promise<void> {
  // Retire cancelled/abandoned browser attempts before preparing a fresh one.
  clearPendingDesktopAuth();
  if (callback) {
    setAuthCompletionCallback(callback);
  }
  saveReturnLocation();

  let session: AuthSession;
  try { session = getSession() ? await restoreAuthSession(getSession()!) : await initAuthSession(); }
  catch (error) {
    // The user explicitly chose Google sign-in. Preserve the invalid session,
    // then establish the ordinary guest context required by the OAuth flow.
    if (!(error instanceof SessionRecoveryError)) throw error;
    session = await createGuestSession(true);
  }
  const codeVerifier = generateRandomString(32);
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  const flow = isTauri() ? "desktop" : "browser";
  const response = await fetch(`${API_BASE_URL}/auth/prepare`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}`, "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ flow, code_challenge: codeChallenge }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string; retryAfter?: number } | null;
    const retry = response.status === 429 && failure?.retryAfter ? ` Try again in ${Math.ceil(failure.retryAfter / 60)} minute(s).` : "";
    throw new Error((failure?.error || `Unable to start Google sign-in (${response.status}). Please try again.`) + retry);
  }
  const prepared = await response.json() as { state: string; url: string };
  savePendingDesktopAuth(prepared.state, codeVerifier);
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(prepared.url);
    } catch (error) {
      if (getPendingDesktopAuth()?.state === prepared.state) clearPendingDesktopAuth();
      throw error;
    }
  } else {
    window.location.href = prepared.url;
  }
}

/**
 * Polls the backend for desktop authentication completion.
 * Used as a zero-friction fallback alongside custom protocol deep-linking.
 */
export async function pollDesktopAuthStatus(
  state: string,
  codeVerifier: string,
  signal?: AbortSignal
): Promise<AuthSession | null> {
  const startTime = Date.now();
  const maxWaitMs = 90_000;
  const intervalMs = 1500;

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted || getPendingDesktopAuth()?.state !== state) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/desktop-poll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ state, code_verifier: codeVerifier }),
        signal,
      });

      if (response.ok) {
        const sessionData = (await response.json()) as AuthSession;
        if (signal?.aborted || getPendingDesktopAuth()?.state !== state) return null;
        if (sessionData?.token && sessionData?.account?.id) {
          await migrateLocalGuest(sessionData);
          clearPendingDesktopAuth();
          setSession(sessionData);
          triggerAuthCompletionCallback(sessionData);
          return sessionData;
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return null;
      }
    }

    await new Promise((res) => setTimeout(res, intervalMs));
  }

  if (getPendingDesktopAuth()?.state === state) clearPendingDesktopAuth();
  return null;
}

/**
 * Parses and processes a desktop custom deep-link URI (alfred://auth/callback?ticket=...&state=...).
 * Verifies scheme, extracts ticket, matches state against the active pending attempt,
 * immediately wipes the PKCE verifier, and atomically exchanges the ticket.
 */
export async function handleDesktopDeepLink(rawUrl: string): Promise<AuthSession | null> {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const cleanUrl = rawUrl.trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
  if (!cleanUrl.startsWith("alfred://auth/callback") && !cleanUrl.startsWith("alfred:/auth/callback")) return null;
  const url = new URL(cleanUrl.replace(/^alfred:\/+/i, "https://alfred-app/"));
  const returnedState = url.searchParams.get("state");
  const pending = getPendingDesktopAuth();
  // A cancelled/older browser tab must never clear a newer login attempt.
  if (!pending || pending.state !== returnedState) return null;
  try {
    const authError = url.searchParams.get("auth_error");
    if (authError === "authorization_rejected" || authError === "access_denied") throw new DesktopAuthCancelledError();
    if (authError) throw new Error(`Desktop authentication failed: ${authError}`);
    const ticket = url.searchParams.get("ticket");
    if (!ticket) throw new Error("Missing ticket in desktop callback");
    const session = await exchangeTicket(ticket, pending.codeVerifier, pending.state);
    if (getPendingDesktopAuth()?.state !== pending.state) return null;
    clearPendingDesktopAuth();
    triggerAuthCompletionCallback(session);
    return session;
  } catch (err) {
    if (getPendingDesktopAuth()?.state === pending.state) clearPendingDesktopAuth();
    throw err;
  }
}
