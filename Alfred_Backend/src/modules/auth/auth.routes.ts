import { Router } from "express";
import {
    authRateLimiter,
    guestRateLimiter,
} from "../../middleware/rateLimit.middleware.ts";
import { validate } from "../../middleware/validate.middleware.ts";
import {
    exchangeTicket,
    googleAuth,
    googleAuthCallback,
    guestAuth,
} from "./auth.controller.ts";
import {
    exchangeTicketSchema,
    googleCallbackSchema,
    guestAuthSchema,
} from "./auth.schema.ts";

const router = Router();

router.post("/guest", guestRateLimiter, validate(guestAuthSchema), guestAuth);
router.get("/google", authRateLimiter, googleAuth);
router.get("/google/callback", validate(googleCallbackSchema), googleAuthCallback);
router.post("/exchange", authRateLimiter, validate(exchangeTicketSchema), exchangeTicket);

export default router;

