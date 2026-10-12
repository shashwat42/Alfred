import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { aiRateLimiter } from "../../middleware/rateLimit.middleware.ts";
import { validate } from "../../middleware/validate.middleware.ts";
import { chatRequestSchema } from "./ai.schema.ts";
import { chatCompletionHandler } from "./controller.ts";

const router = Router();

// Authentication is strictly required for AI endpoints
router.use(authMiddleware);

// Dedicated rate limiting and payload validation for AI chat
router.post(
    "/chat",
    aiRateLimiter,
    validate({ body: chatRequestSchema }),
    chatCompletionHandler
);

export default router;
