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
export const API_BASE_URL = "http://localhost:8000";

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

    // Corrupt or invalid shape, clean up
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
 * Exchanges a short-lived, one-time OAuth handoff ticket for an authenticated Alfred session.
 */
export async function exchangeTicket(ticket: string): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ticket }),
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
          return session;
        } catch (err) {
          console.error("Ticket exchange failed, falling back to guest session:", err);
          cachedTicket = null;
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
 * Redirects the browser to backend Google OAuth initiation endpoint.
 */
export function loginWithGoogle(): void {
  window.location.href = `${API_BASE_URL}/auth/google`;
}
