import { env } from "../../config/env.ts";
import type { ChatMessageInput } from "./ai.schema.ts";

export class AiServiceError extends Error {
    public readonly statusCode: number;
    public readonly publicMessage: string;

    constructor(statusCode: number, publicMessage: string) {
        super(publicMessage);
        this.name = "AiServiceError";
        this.statusCode = statusCode;
        this.publicMessage = publicMessage;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface ChatCompletionResult {
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

export const UNSUPPORTED_TOOL_PROTOCOL_REGEX =
    /<\/?(?:dots_function_call|invoke|function_call|tool_call|dispatch)[\s>]/i;

export const SAFETY_EVALUATION_TEMPLATE_REGEX =
    /^\s*(?:User Safety:\s*(?:safe|unsafe)|Response Safety:\s*(?:safe|unsafe))/i;

const ALFRED_SYSTEM_PROMPT =
    "You are Alfred, an intelligent, natural, and friendly AI personal productivity assistant embedded in a dashboard.\n" +
    "Guidelines:\n" +
    "1. Conversational Style: Respond naturally and warmly to greetings (e.g., 'Hey Alfred', 'hi'), casual remarks, slang, and informal language without canned introductions or robotic disclaimers.\n" +
    "2. Direct & Concise: Provide concise, direct answers to simple queries. Expand only when detailed explanation is requested.\n" +
    "3. Capabilities & Scope: When asked what you can do or how you can help, provide a concise, structured overview covering:\n" +
    "   - Tasks: Organize to-dos, prioritize work, and break projects into steps.\n" +
    "   - Schedules: Plan daily routines, time blocks, and meeting agendas.\n" +
    "   - Notes: Capture ideas and organize information.\n" +
    "   - Focus: Structure focus sessions and suggest productivity techniques.\n" +
    "   Finish by asking what the user would like help with first. Accurately describe current capabilities: you assist through conversation, brainstorming, and advice; only claim an action was completed when an integrated tool execution confirms it.\n" +
    "4. Boundaries & Unsupported Features: You do not manage, read, draft, or send emails (or check inboxes); if asked about email, politely explain that email management is not currently supported. Never claim to have inspected device hardware, local files, or external tool state. Do not output tool pseudo-protocol tags such as <invoke> or <dots_function_call>.\n" +
    "5. Ambiguity Resolution: When a prompt is ambiguous or incomplete (e.g., 'check', 'status', 'update'), ask a single focused clarifying question (e.g., 'What would you like me to check?').\n" +
    "6. Context Continuity: Actively use conversation history to interpret follow-up questions (e.g., 'what does that mean', 'why').\n" +
    "7. Safety & Formatting: Never output safety classification templates (such as 'User Safety: safe' or 'Response Safety: safe'). Communicate exclusively in human-friendly conversational language and clean Markdown.";

/**
 * Normalizes input messages from either an array or an optional prompt parameter.
 */
export function normalizeMessages(
    messages?: ChatMessageInput[],
    singleMessage?: string
): ChatMessageInput[] {
    const list: ChatMessageInput[] = messages ? [...messages] : [];
    if (singleMessage !== undefined && singleMessage.trim().length > 0) {
        list.push({
            role: "user",
            content: singleMessage.trim(),
        });
    }
    return list;
}

/**
 * Calls the configured upstream LLM provider endpoint.
 * Strictly uses the configured LLM_MODEL with no paid-model fallback.
 * Isolates upstream headers, handles timeouts, and guarantees sensitive error details
 * and provider credentials are never leaked.
 */
export async function generateChatCompletion(
    clientMessages: ChatMessageInput[]
): Promise<ChatCompletionResult> {
    const apiKey = env.llm.apiKey;
    if (!apiKey || apiKey.trim().length === 0) {
        throw new AiServiceError(
            503,
            "AI service is not configured. Please contact the administrator."
        );
    }

    const systemMessage = {
        role: "system",
        content: ALFRED_SYSTEM_PROMPT,
    };

    const upstreamPayload = {
        model: env.llm.model,
        messages: [
            systemMessage,
            ...clientMessages.map((msg) => ({
                role: msg.role,
                content: msg.content,
            })),
        ],
        max_tokens: env.llm.maxOutputTokens,
    };

    const targetUrl = `${env.llm.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
    };

    let response: Response;
    try {
        response = await fetch(targetUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(upstreamPayload),
            signal: AbortSignal.timeout(env.llm.timeoutMs),
        });
    } catch (err: unknown) {
        if (
            err instanceof Error &&
            (err.name === "TimeoutError" || err.name === "AbortError")
        ) {
            throw new AiServiceError(504, "AI request timed out. Please try again.");
        }
        // Network or fetch failure without revealing URLs, keys, or stack details
        throw new AiServiceError(502, "Failed to connect to AI provider.");
    }

    if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
            throw new AiServiceError(
                502,
                "AI provider authentication failed. Please check provider credentials."
            );
        }
        if (status === 402) {
            throw new AiServiceError(
                502,
                "AI provider credits depleted. Please try again later."
            );
        }
        if (status === 404) {
            throw new AiServiceError(
                502,
                "The configured AI model is unavailable or discontinued by the provider."
            );
        }
        if (status === 429) {
            throw new AiServiceError(
                429,
                "AI provider rate limit reached. Please slow down and try again later."
            );
        }
        if (status === 503) {
            throw new AiServiceError(
                502,
                "AI provider is temporarily unavailable due to high demand. Please try again shortly."
            );
        }
        if (status >= 500) {
            throw new AiServiceError(
                502,
                "AI provider is currently experiencing an outage. Please try again later."
            );
        }
        throw new AiServiceError(
            502,
            "AI provider returned an unexpected error."
        );
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch {
        throw new AiServiceError(
            502,
            "Malformed response received from AI provider."
        );
    }

    if (
        typeof data !== "object" ||
        data === null ||
        !("choices" in data) ||
        !Array.isArray((data as { choices: unknown }).choices) ||
        (data as { choices: unknown[] }).choices.length === 0
    ) {
        throw new AiServiceError(
            502,
            "Malformed response: Missing choices from AI provider."
        );
    }

    const firstChoice = (data as { choices: Array<{ message?: unknown; finish_reason?: unknown }> }).choices[0];
    if (
        !firstChoice ||
        typeof firstChoice !== "object" ||
        !("message" in firstChoice) ||
        typeof firstChoice.message !== "object" ||
        firstChoice.message === null
    ) {
        throw new AiServiceError(
            502,
            "Malformed response: Missing message payload from AI provider."
        );
    }

    const messageObj = firstChoice.message as { content?: unknown };
    if (typeof messageObj.content !== "string") {
        throw new AiServiceError(
            502,
            "Malformed response: Missing text content in AI message."
        );
    }

    if (UNSUPPORTED_TOOL_PROTOCOL_REGEX.test(messageObj.content)) {
        throw new AiServiceError(
            502,
            "The AI provider returned an unsupported tool protocol message. Please ask your question directly."
        );
    }

    if (SAFETY_EVALUATION_TEMPLATE_REGEX.test(messageObj.content)) {
        throw new AiServiceError(
            502,
            "The AI provider returned an evaluation output instead of a conversational message. Please try asking again."
        );
    }

    const finishReason =
        typeof firstChoice.finish_reason === "string"
            ? firstChoice.finish_reason
            : null;

    const rawUsage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } }).usage;
    const usage =
        rawUsage && typeof rawUsage === "object"
            ? {
                  ...(typeof rawUsage.prompt_tokens === "number"
                      ? { promptTokens: rawUsage.prompt_tokens }
                      : {}),
                  ...(typeof rawUsage.completion_tokens === "number"
                      ? { completionTokens: rawUsage.completion_tokens }
                      : {}),
                  ...(typeof rawUsage.total_tokens === "number"
                      ? { totalTokens: rawUsage.total_tokens }
                      : {}),
              }
            : undefined;

    const modelName =
        typeof (data as unknown as { model?: unknown }).model === "string"
            ? ((data as unknown as { model: string }).model)
            : env.llm.model;

    return {
        message: {
            role: "assistant",
            content: messageObj.content,
        },
        model: modelName,
        finishReason,
        ...(usage ? { usage } : {}),
    };
}
