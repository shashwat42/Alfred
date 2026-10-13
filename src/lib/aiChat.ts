import { apiFetch } from "./api.ts";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  error?: string;
}

export interface ChatCompletionResponse {
  message: {
    role: "assistant";
    content: string;
  };
  model: string;
  finishReason: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export const MAX_MESSAGES_CONTEXT = 20;
export const MAX_MESSAGE_CHAR_LIMIT = 4000;
export const MAX_TOTAL_CONTEXT_CHARS = 20000;

/**
 * Builds a validated, bounded context array for the backend AI endpoint.
 * Preserves the latest user prompt, limits prior history to recent relevant messages,
 * and strictly ensures the backend limits (<= 20 messages, <= 4000 chars/msg, <= 20000 total chars)
 * and terminal 'user' role requirement are met.
 */
export function buildSafeChatContext(
  history: ChatMessage[],
  latestUserText: string
): Array<{ role: "user" | "assistant"; content: string }> {
  const trimmedLatest = latestUserText.trim().slice(0, MAX_MESSAGE_CHAR_LIMIT);
  const validHistory = history.filter((m) => !m.error && m.content.trim().length > 0);

  let remainingChars = MAX_TOTAL_CONTEXT_CHARS - trimmedLatest.length;
  const maxPrior = MAX_MESSAGES_CONTEXT - 1;

  const includedPrior: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = validHistory.length - 1; i >= 0 && includedPrior.length < maxPrior; i--) {
    const item = validHistory[i];
    if (!item) continue;
    const itemContent = item.content.trim().slice(0, MAX_MESSAGE_CHAR_LIMIT);
    if (itemContent.length <= remainingChars) {
      includedPrior.unshift({
        role: item.role,
        content: itemContent,
      });
      remainingChars -= itemContent.length;
    } else {
      break;
    }
  }

  includedPrior.push({
    role: "user",
    content: trimmedLatest,
  });

  return includedPrior;
}

/**
 * Sends a chat completion request to the backend AI endpoint.
 * Reuses existing apiFetch with auto-Bearer token injection and sanitized error mapping.
 */
export async function sendChatMessage(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const response = await apiFetch("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!response.ok) {
    let errorMessage = "Failed to communicate with Alfred AI.";
    try {
      const errorData = (await response.json()) as { error?: string };
      if (errorData?.error && typeof errorData.error === "string") {
        errorMessage = errorData.error;
      }
    } catch {
      // non-JSON response fallback
    }

    if (response.status === 401) {
      errorMessage = "Session expired or unauthorized. Please sign in again.";
    } else if (response.status === 429) {
      errorMessage = "Too many requests. Please slow down and try again shortly.";
    } else if (response.status === 503) {
      errorMessage = "AI service is not configured. Please contact the administrator.";
    } else if (response.status === 504) {
      errorMessage = "Alfred took too long to respond. Please try again.";
    }

    const error = new Error(errorMessage) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as ChatCompletionResponse;
}
