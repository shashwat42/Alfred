import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { Router } from "express";
import {
    authRateLimiter,
    desktopPollRateLimiter,
    guestRateLimiter,
} from "../../middleware/rateLimit.middleware.ts";
import { validate } from "../../middleware/validate.middleware.ts";
import {
    desktopPoll,
    exchangeTicket,
    googleAuth,
    googleAuthCallback,
    guestAuth,
    prepareOAuth,
    logout,
    restoreSession,
    renewGuestSession,
} from "./auth.controller.ts";
import {
    desktopPollSchema,
    exchangeTicketSchema,
    googleAuthSchema,
    googleCallbackSchema,
    guestAuthSchema,
    prepareOAuthSchema,
} from "./auth.schema.ts";

const router = Router();
router.get("/session", authMiddleware, restoreSession);
router.post("/guest/renew", authRateLimiter, renewGuestSession);

router.post("/prepare", authRateLimiter, authMiddleware, validate(prepareOAuthSchema), prepareOAuth);
router.post("/logout", authMiddleware, logout);
router.post("/guest", guestRateLimiter, validate(guestAuthSchema), guestAuth);
router.get("/google", authRateLimiter, validate(googleAuthSchema), googleAuth);
router.get("/google/callback", validate(googleCallbackSchema), googleAuthCallback);
router.post("/exchange", authRateLimiter, validate(exchangeTicketSchema), exchangeTicket);
router.post("/desktop-poll", desktopPollRateLimiter, validate(desktopPollSchema), desktopPoll);

export default router;
