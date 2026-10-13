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

    return data as RawUpstreamResponse;
}

/**
 * Calls the configured upstream LLM provider with function calling support.
 * Guarantees identity isolation by strictly routing tool calls through the authenticated accountId.
 * Executes a bounded multi-turn tool calling loop up to 5 iterations.
 */
export async function generateChatCompletion(
    clientMessages: ChatMessageInput[],
    accountId?: string
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

    const actionsExecuted: ConfirmedAction[] = [];
    const MAX_TOOL_ITERATIONS = 5;
    let iteration = 0;
    let finalContent = "";
    let finalModel = env.llm.model;
    let finalFinishReason: string | null = null;
    let aggregateUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

    while (iteration < MAX_TOOL_ITERATIONS) {
        iteration++;

        const upstreamPayload: Record<string, unknown> = {
            model: env.llm.model,
            messages: conversationMessages,
            max_tokens: env.llm.maxOutputTokens,
        };

        // Only provide tools if account context is available
        if (accountId) {
            upstreamPayload.tools = AI_TOOLS;
            upstreamPayload.tool_choice = "auto";
        }

        const data = await sendUpstreamRequest(upstreamPayload, apiKey);
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
