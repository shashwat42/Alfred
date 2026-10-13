import type { Request, Response } from "express";
import type { ChatRequestBody } from "./ai.schema.ts";
import { requireAccountId } from "../../utils/requireAccountId.ts";
import {
    AiServiceError,
    generateChatCompletion,
    normalizeMessages,
} from "./service.ts";

export async function chatCompletionHandler(
    req: Request<Record<string, never>, unknown, ChatRequestBody>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const clientMessages = normalizeMessages(
            req.body.messages,
            req.body.message
        );

        const result = await generateChatCompletion(clientMessages, accountId);
        res.json(result);
    } catch (err: unknown) {
        if (err instanceof AiServiceError) {
            res.status(err.statusCode).json({ error: err.publicMessage });
            return;
        }

        console.error("Unhandled error during chat completion:", err instanceof Error ? err.message : err);
        res.status(500).json({ error: "An unexpected error occurred processing your request." });
    }
}
