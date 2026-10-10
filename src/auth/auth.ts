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
let inFlightInitPromise: Promise<AuthSession> | null = null;

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
 * Cleans up local session on failure and throws an error.
 */
export async function createGuestSession(): Promise<AuthSession> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/guest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      clearSession();
      throw new Error(`Guest session creation failed (${response.status}): ${errorBody}`);
    }

    const sessionData = (await response.json()) as AuthSession;
    if (!sessionData?.token || !sessionData?.account?.id) {
      clearSession();
      throw new Error("Invalid guest session data received from server");
    }

    setSession(sessionData);
    return sessionData;
  } catch (error) {
    clearSession();
    throw error;
  }
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
  state: string;
  codeVerifier: string;
  expiresAt: number;
}

let memoryPendingAuth: PendingDesktopAuth | null = null;

export function savePendingDesktopAuth(state: string, codeVerifier: string): void {
  const pending: PendingDesktopAuth = {
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
export async function exchangeTicket(ticket: string, codeVerifier?: string): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

  setSession(sessionData);
  return sessionData;
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
 * 3. Creates a guest session if unauthenticated.
 */
export function initAuthSession(): Promise<AuthSession> {
  if (inFlightInitPromise) {
    return inFlightInitPromise;
  }

  inFlightInitPromise = (async () => {
    try {
      const { ticket, authError } = checkUrlAuthParameters();

      if (authError) {
        console.warn("OAuth parameter error encountered during initialization:", authError);
      }

      if (ticket) {
        try {
          const session = await exchangeTicket(ticket);
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
          console.error("Ticket exchange failed, falling back to guest session:", err);
          cachedTicket = null;
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
        return existingSession;
      }

      return await createGuestSession();
    } finally {
      inFlightInitPromise = null;
    }
  })();

  return inFlightInitPromise;
}

/**
 * Initiates Google OAuth login.
 * On desktop (Tauri): generates PKCE challenge & state, stores verifier, and launches external system browser.
 * On browser: redirects current window to backend Google auth endpoint.
 */
export async function loginWithGoogle(callback?: AuthCallback): Promise<void> {
  if (callback) {
    setAuthCompletionCallback(callback);
  }
  saveReturnLocation();

  if (isTauri()) {
    try {
      const codeVerifier = generateRandomString(32);
      const codeChallenge = await deriveCodeChallenge(codeVerifier);
      const state = `desktop_${generateRandomString(24)}`;

      savePendingDesktopAuth(state, codeVerifier);

      const targetUrl = `${API_BASE_URL}/auth/google?flow=desktop&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;

      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(targetUrl);
      return;
    } catch (err) {
      clearPendingDesktopAuth();
      console.error("Failed to open external browser for desktop Google sign-in:", err);
      throw err;
    }
  }

  window.location.href = `${API_BASE_URL}/auth/google`;
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
    if (signal?.aborted) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/desktop-poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, code_verifier: codeVerifier }),
        signal,
      });

      if (response.ok) {
        const sessionData = (await response.json()) as AuthSession;
        if (sessionData?.token && sessionData?.account?.id) {
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

  return null;
}

/**
 * Parses and processes a desktop custom deep-link URI (alfred://auth/callback?ticket=...&state=...).
 * Verifies scheme, extracts ticket, matches state against the active pending attempt,
 * immediately wipes the PKCE verifier, and atomically exchanges the ticket.
 */
export async function handleDesktopDeepLink(rawUrl: string): Promise<AuthSession | null> {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  // Normalize quotes or trailing slashes that Windows or browsers may append
  const cleanUrl = rawUrl.trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");

  // Accept alfred://auth/callback or alfred:/auth/callback (Windows can strip one slash)
  if (!cleanUrl.startsWith("alfred://auth/callback") && !cleanUrl.startsWith("alfred:/auth/callback")) {
    return null;
  }

  try {
    // Normalize: replace the alfred:// or alfred:/ scheme prefix so URL() can parse query params
    const httpUrl = cleanUrl.replace(/^alfred:\/+/i, "https://alfred-app/");
    const urlObj = new URL(httpUrl);
    const searchParams = urlObj.searchParams;

    const authError = searchParams.get("auth_error");
    if (authError) {
      clearPendingDesktopAuth();
      throw new Error(`Desktop authentication failed: ${authError}`);
    }

    const ticket = searchParams.get("ticket");
    const returnedState = searchParams.get("state");

    if (!ticket || !returnedState) {
      clearPendingDesktopAuth();
      throw new Error("Missing ticket or state in desktop callback");
    }

    const pending = getPendingDesktopAuth();
    if (!pending) {
      // If already authenticated (e.g. by polling), return existing session
      const existing = getSession();
      if (existing) return existing;
      throw new Error("No active pending desktop authentication attempt found or attempt expired");
    }

    if (pending.state !== returnedState) {
      clearPendingDesktopAuth();
      throw new Error("Mismatched OAuth state in desktop callback");
    }

    const verifier = pending.codeVerifier;
    clearPendingDesktopAuth(); // Immediately wipe sensitive verifier from storage

    const session = await exchangeTicket(ticket, verifier);
    triggerAuthCompletionCallback(session);
    return session;
  } catch (err) {
    clearPendingDesktopAuth();
    throw err;
  }
}
