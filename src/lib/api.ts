import {
  API_BASE_URL,
  checkUrlAuthParameters,
  getToken,
  getSession,
  initAuthSession,
} from "../auth/auth.ts";

let inFlightAuthPromise: Promise<string | null> | null = null;

/**
 * Ensures an active authorization token exists, creating a guest session if needed.
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
        const session = await initAuthSession();
        return session.token;
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
 * provisions guest sessions on-the-fly, and handles base URL resolution.
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

  const response = await fetch(url, {
    ...init,
    headers,
  });

  return response;
}

/**
 * Helper to make authenticated JSON requests and parse the response body.
 */
export async function apiJson<T = unknown>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const response = await apiFetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`API error (${response.status}): ${errorText || response.statusText}`);
  }

  return (await response.json()) as T;
}
