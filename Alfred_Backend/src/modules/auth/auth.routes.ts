import { Router } from "express";
import {
    authRateLimiter,
    guestRateLimiter,
} from "../../middleware/rateLimit.middleware.ts";
import { validate } from "../../middleware/validate.middleware.ts";
import {
    desktopPoll,
    exchangeTicket,
    googleAuth,
    googleAuthCallback,
    guestAuth,
} from "./auth.controller.ts";
import {
    desktopPollSchema,
    exchangeTicketSchema,
    googleAuthSchema,
    googleCallbackSchema,
    guestAuthSchema,
} from "./auth.schema.ts";

const router = Router();

router.post("/guest", guestRateLimiter, validate(guestAuthSchema), guestAuth);
router.get("/google", authRateLimiter, validate(googleAuthSchema), googleAuth);
router.get("/google/callback", validate(googleCallbackSchema), googleAuthCallback);
router.post("/exchange", authRateLimiter, validate(exchangeTicketSchema), exchangeTicket);
router.post("/desktop-poll", authRateLimiter, validate(desktopPollSchema), desktopPoll);

export default router;
