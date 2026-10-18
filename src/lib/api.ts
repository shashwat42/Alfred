import {
  API_BASE_URL,
  checkUrlAuthParameters,
  getToken,
  getSession,
  initAuthSession,
  renewGuestSession,
  reportInvalidSession,
  SessionRecoveryError,
} from "../auth/auth.ts";

let inFlightAuthPromise: Promise<string | null> | null = null;

/**
 * Restores authorization without creating an account before the user's choice.
 */
export async function ensureToken(): Promise<string | null> {
  const { ticket } = checkUrlAuthParameters();
  // Only use existingToken immediately if there is no pending OAuth ticket to exchange
  if (!ticket) {
    const existingToken = getToken();
    if (existingToken) return existingToken;
  }

  if (!inFlightAuthPromise) {
    inFlightAuthPromise = (async () => {
      try {
        const session = await initAuthSession(false);
        return session?.token ?? null;
      } catch (err) {
        console.error("Failed to ensure auth token:", err);
        return null;
      } finally {
        inFlightAuthPromise = null;
      }
    })();
  }

  return inFlightAuthPromise;
}

/**
 * Builds full URL from endpoint or returns URL as-is if already absolute.
 */
function buildUrl(endpointOrUrl: string): string {
  if (endpointOrUrl.startsWith("http://") || endpointOrUrl.startsWith("https://")) {
    return endpointOrUrl;
  }
  const cleanPath = endpointOrUrl.startsWith("/") ? endpointOrUrl : `/${endpointOrUrl}`;
  return `${API_BASE_URL}${cleanPath}`;
}

/**
 * Wrapper around window.fetch that automatically injects the Authorization Bearer token,
 * restores existing sessions and handles base URL resolution.
 */
export async function apiFetch(
  input: string,
  init: RequestInit & { _isRetry?: boolean; _preserveAccount?: boolean; _expectedAccountId?: string } = {}
): Promise<Response> {
  const url = buildUrl(input);
  const headers = new Headers(init.headers);

  const token = headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || (await ensureToken());
  if (init._expectedAccountId && getSession()?.account.id !== init._expectedAccountId) {
    throw new Error("Your account changed. Please try again.");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  if (!headers.has("ngrok-skip-browser-warning")) {
    headers.set("ngrok-skip-browser-warning", "true");
  }

  let response: Response;
  try {
    const timeout = AbortSignal.timeout(input.includes("/api/ai/") ? 120_000 : 20_000);
    response = await fetch(url, { ...init, headers,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("The request timed out. Please retry; your input is preserved.", { cause: error });
    throw new Error(typeof navigator !== "undefined" && !navigator.onLine ? "You’re offline. Check your connection and retry." : "The Alfred server could not be reached. Please retry.", { cause: error });
  }
  if (response.status === 401 && token) {
    const current = getSession();
    if (!init._isRetry && current?.token === token && current.account.type === "guest") {
      try {
        const renewed = await renewGuestSession(current);
        const retryHeaders = new Headers(headers); retryHeaders.set("Authorization", `Bearer ${renewed.token}`);
        return apiFetch(input, { ...init, headers: retryHeaders, _isRetry: true, _expectedAccountId: current.account.id });
      } catch (error) {
        if (!(error instanceof SessionRecoveryError)) throw error;
      }
    }
    reportInvalidSession(token);
  }
  return response;
}

/**
 * Helper to make authenticated JSON requests and parse the response body.
 */
export async function apiJson<T = unknown>(input: string, init: RequestInit & { _expectedAccountId?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const response = await apiFetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new Error(response.status === 401 ? "Your session needs recovery. You can continue as a guest without signing in." : payload?.error || `Request failed (${response.status}). Please retry.`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
