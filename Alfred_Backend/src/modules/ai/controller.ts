import type { Request, Response } from "express";
import { sendPolicyError } from "../../security/errors.ts";
import { PolicyError } from "../../security/errors.ts";
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

        if (!req.body.localWorkspace && req.account?.cloudSyncEnabled !== true) throw new PolicyError(409, "LOCAL_WORKSPACE_REQUIRED", "Open Alfred to use the workspace stored on this device, or enable Cloud Sync.");
        const result = await generateChatCompletion(clientMessages, accountId, undefined, [], req.get("Idempotency-Key"), req.body.localWorkspace);
        res.json(result);
    } catch (err: unknown) {
        if (sendPolicyError(err, res)) return;
        if (err instanceof AiServiceError) {
            res.status(err.statusCode).json({ error: err.publicMessage });
            return;
        }

        console.error("Unhandled error during chat completion:", { name: err instanceof Error ? err.name : "Unknown" });
        res.status(500).json({ error: "An unexpected error occurred processing your request." });
    }
}
