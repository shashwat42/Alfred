import { env } from "../../config/env.ts";
import type { ChatMessageInput } from "./ai.schema.ts";
import { buildAlfredSystemPrompt, ALFRED_SYSTEM_PROMPT } from "./prompt.ts";
import { AI_TOOLS, executeAiTool, type ConfirmedAction } from "./tools.ts";

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
    actionsExecuted?: ConfirmedAction[];
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

export { ALFRED_SYSTEM_PROMPT };

/**
 * Normalizes input messages from either an array or an optional prompt parameter.
 */
export function normalizeMessages(
    messages?: ChatMessageInput[],
    singleMessage?: string
): ChatMessageInput[] {
    const list: ChatMessageInput[] = messages ? [...messages] : [];
    if (singleMessage !== undefined && singleMessage.trim().length > 0) {
        const trimmedSingle = singleMessage.trim();
        const lastMsg = list[list.length - 1];
        if (
            !lastMsg ||
            lastMsg.role !== "user" ||
            lastMsg.content.trim() !== trimmedSingle
        ) {
            list.push({
                role: "user",
                content: trimmedSingle,
            });
        }
    }
    return list;
}

interface RawUpstreamChoice {
    message?: {
        role?: string;
        content?: string | null;
        tool_calls?: Array<{
            id: string;
            type: string;
            function: {
                name: string;
                arguments: string;
            };
        }>;
    };
    finish_reason?: string | null;
}

interface RawUpstreamResponse {
    choices?: RawUpstreamChoice[];
    model?: string;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}

async function sendUpstreamRequest(
    payload: Record<string, unknown>,
    apiKey: string
): Promise<RawUpstreamResponse> {
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
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(env.llm.timeoutMs),
        });
    } catch (err: unknown) {
        if (
            err instanceof Error &&
            (err.name === "TimeoutError" || err.name === "AbortError")
        ) {
            throw new AiServiceError(504, "AI request timed out. Please try again.");
        }
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
                404,
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
                503,
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

    return data as RawUpstreamResponse;
}

let currentActiveModel = env.llm.model;

export function getActiveModel(): string {
    return currentActiveModel;
}

export function getAllCandidateModels(): string[] {
    const list = [env.llm.model, ...(env.llm.fallbackModels || [])];
    return Array.from(new Set(list.filter((m): m is string => Boolean(m) && m.trim().length > 0)));
}

/**
 * Probes a specific model with a short deadline to test responsiveness on app startup.
 */
export async function probeModelHealth(
    model: string,
    timeoutMs = 6000
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const apiKey = env.llm.apiKey;
    if (!apiKey) return { ok: false, latencyMs: 0, error: "Missing API key" };

    const targetUrl = `${env.llm.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const start = Date.now();
    try {
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 5,
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });

        const latencyMs = Date.now() - start;
        if (!response.ok) {
            return { ok: false, latencyMs, error: `HTTP ${response.status}` };
        }
        return { ok: true, latencyMs };
    } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        return {
            ok: false,
            latencyMs,
            error: err instanceof Error ? err.name : "Probe failed",
        };
    }
}

/**
 * Initializes and checks AI model availability on app startup.
 * Checks candidate models without changing configured request priority.
 */
export async function initializeAiService(): Promise<void> {
    const candidates = getAllCandidateModels();
    console.log(`[AI Init] Verifying model availability across: ${candidates.join(", ")}`);

    for (const model of candidates) {
        const result = await probeModelHealth(model, 6000);
        if (result.ok) {
            // Health probes report availability; they do not reorder request priority.
            console.log(`[AI Init] Responsive model "${model}" (probe latency: ${result.latencyMs}ms)`);
            return;
        }
        console.warn(`[AI Init] Model "${model}" failed health probe (${result.error}, ${result.latencyMs}ms). Checking next...`);
    }

    console.warn(`[AI Init] All model probes failed. Falling back to primary "${env.llm.model}".`);
    currentActiveModel = env.llm.model;
}

/**
 * Sends upstream request with automatic failover to backup models if primary times out or fails.
 */
async function sendUpstreamRequestWithFallback(
    payload: Record<string, unknown>,
    apiKey: string
): Promise<RawUpstreamResponse> {
    const candidates = getAllCandidateModels();

    let lastError: unknown = null;

    for (let i = 0; i < candidates.length; i++) {
        const candidateModel = candidates[i]!;
        payload.model = candidateModel;

        try {
            const data = await sendUpstreamRequest(payload, apiKey);
            // Keep configured primary first on the next request, including after failover.
            if (!data.model) data.model = candidateModel;
            return data;
        } catch (err: unknown) {
            lastError = err;
            const isRetriable =
                err instanceof AiServiceError &&
                (err.statusCode === 504 ||
                    err.statusCode === 503 ||
                    err.statusCode === 502 ||
                    err.statusCode === 429 ||
                    err.statusCode === 404);

            const hasNextCandidate = i + 1 < candidates.length;
            if (isRetriable && hasNextCandidate) {
                const nextModel = candidates[i + 1]!;
                console.warn(
                    `[AI Failover] Model "${candidateModel}" failed with status ${
                        (err as AiServiceError).statusCode
                    } (${(err as AiServiceError).publicMessage}). Failing over to "${nextModel}"...`
                );
                continue;
            }
            throw err;
        }
    }

    if (lastError instanceof AiServiceError) {
        throw lastError;
    }
    throw new AiServiceError(502, "All candidate AI models failed to respond.");
}

/**
 * Calls the configured upstream LLM provider with function calling support.
 * Guarantees identity isolation by strictly routing tool calls through the authenticated accountId.
 * Executes a bounded multi-turn tool calling loop up to 5 iterations.
 */
export async function generateChatCompletion(
    clientMessages: ChatMessageInput[],
    accountId?: string,
    audio?: { data: string; format: "wav" },
    historyAudio: Array<{ index: number; data: string; format: "wav" }> = []
): Promise<ChatCompletionResult> {
    const apiKey = env.llm.apiKey;
    if (!apiKey || apiKey.trim().length === 0) {
        throw new AiServiceError(
            503,
            "AI service is not configured. Please contact the administrator."
        );
    }

    const systemPromptText = buildAlfredSystemPrompt();
    const systemMessage = {
        role: "system",
        content: systemPromptText,
    };

    const conversationMessages: Array<Record<string, unknown>> = [
        systemMessage,
        ...clientMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
        })),
    ];

    if (audio) {
        const latest = conversationMessages[conversationMessages.length - 1]!;
        latest.content = [
            { type: "text", text: latest.content },
            { type: "input_audio", input_audio: audio },
        ];
    }
    for (const { index, data, format } of historyAudio) {
        const message = conversationMessages[index + 1]!;
        message.content = [{ type: "text", text: message.content }, { type: "input_audio", input_audio: { data, format } }];
    }

    const actionsExecuted: ConfirmedAction[] = [];
    const MAX_TOOL_ITERATIONS = 5;
    let iteration = 0;
    let finalContent = "";
    let finalModel = currentActiveModel;
    let finalFinishReason: string | null = null;
    let aggregateUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

    while (iteration < MAX_TOOL_ITERATIONS) {
        iteration++;

        const upstreamPayload: Record<string, unknown> = {
            model: currentActiveModel,
            messages: conversationMessages,
            max_tokens: env.llm.maxOutputTokens,
        };

        // Only provide tools if account context is available
        if (accountId) {
            upstreamPayload.tools = AI_TOOLS;
            upstreamPayload.tool_choice = "auto";
        }

        const data = await sendUpstreamRequestWithFallback(upstreamPayload, apiKey);
        if (data.model) finalModel = data.model;
        if (data.usage) {
            aggregateUsage = {
                promptTokens: (aggregateUsage?.promptTokens ?? 0) + (data.usage.prompt_tokens ?? 0),
                completionTokens: (aggregateUsage?.completionTokens ?? 0) + (data.usage.completion_tokens ?? 0),
                totalTokens: (aggregateUsage?.totalTokens ?? 0) + (data.usage.total_tokens ?? 0),
            };
        }

        const choices = data.choices;
        if (!choices || choices.length === 0 || !choices[0]) {
            throw new AiServiceError(
                502,
                "Malformed response: Missing choices from AI provider."
            );
        }
        const firstChoice = choices[0];
        finalFinishReason = firstChoice.finish_reason ?? null;

        const choiceMessage = firstChoice.message;
        if (!choiceMessage) {
            throw new AiServiceError(
                502,
                "Malformed response: Missing message payload from AI provider."
            );
        }

        const toolCalls = choiceMessage.tool_calls;

        if (Array.isArray(toolCalls) && toolCalls.length > 0 && accountId) {
            // Append assistant tool call message to the ongoing conversation
            conversationMessages.push({
                role: "assistant",
                content: choiceMessage.content ?? null,
                tool_calls: toolCalls,
            });

            // Execute each tool call strictly with verified server accountId
            for (const call of toolCalls) {
                const toolName = call.function?.name || "";
                const toolArgs = call.function?.arguments || "{}";

                const executionResult = await executeAiTool(toolName, toolArgs, accountId);

                if (executionResult.action) {
                    const alreadyTracked = actionsExecuted.some(
                        (a) => a.type === executionResult.action!.type && a.id === executionResult.action!.id
                    );
                    if (!alreadyTracked) {
                        actionsExecuted.push(executionResult.action);
                    }
                }

                // Add tool result message
                conversationMessages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: JSON.stringify(executionResult),
                });
            }

            // Continue the loop so the model sees tool results and generates a natural response
            continue;
        }

        // No tool calls returned: model produced final textual response
        finalContent = typeof choiceMessage.content === "string" ? choiceMessage.content : "";
        break;
    }

    // Safety checks on final response text
    if (UNSUPPORTED_TOOL_PROTOCOL_REGEX.test(finalContent)) {
        throw new AiServiceError(
            502,
            "The AI provider returned an unsupported tool protocol message. Please ask your question directly."
        );
    }

    if (SAFETY_EVALUATION_TEMPLATE_REGEX.test(finalContent)) {
        throw new AiServiceError(
            502,
            "The AI provider returned an evaluation output instead of a conversational message. Please try asking again."
        );
    }

    if (!finalContent && actionsExecuted.length > 0) {
        finalContent = "I've completed the requested operations for you.";
    }

    return {
        message: {
            role: "assistant",
            content: finalContent,
        },
        ...(actionsExecuted.length > 0 ? { actionsExecuted } : {}),
        model: finalModel,
        finishReason: finalFinishReason,
        ...(aggregateUsage ? { usage: aggregateUsage } : {}),
    };
}
