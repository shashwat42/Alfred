import type { Request, Response } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";
import { env } from "../config/env.ts";

/**
 * In-memory stores used for development and single-instance runtimes.
 * For multi-instance clustered or serverless deployments, a shared store
 * (e.g. Redis / MongoDB backed store) would be used instead.
 */
export const guestStore = new MemoryStore();
export const authStore = new MemoryStore();
export const apiStore = new MemoryStore();

function createRateLimitHandler(message: string) {
    return (_req: Request, res: Response): void => {
        const rawRetry = res.getHeader("Retry-After");
        const parsedRetry = typeof rawRetry === "string" ? parseInt(rawRetry, 10) : typeof rawRetry === "number" ? rawRetry : 60;
        const retryAfterSeconds = Number.isFinite(parsedRetry) && parsedRetry > 0 ? parsedRetry : 60;

        res.status(429).json({
            error: message,
            retryAfter: retryAfterSeconds,
        });
    };
}


/**
 * Rate limiter for guest session creation (POST /auth/guest).
 * Enforces a strict threshold to prevent automated account creation abuse.
 */
export const guestRateLimiter = rateLimit({
    windowMs: env.rateLimit.guest.windowMs,
    limit: env.rateLimit.guest.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: guestStore,
    handler: createRateLimitHandler("Too many guest accounts created. Please try again later."),
});

/**
 * Rate limiter for OAuth endpoints (GET /auth/google, POST /auth/exchange).
 * Prevents credential brute-forcing and rapid ticket consumption attempts.
 */
export const authRateLimiter = rateLimit({
    windowMs: env.rateLimit.auth.windowMs,
    limit: env.rateLimit.auth.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: authStore,
    handler: createRateLimitHandler("Too many authentication attempts. Please try again later."),
});

/**
 * Rate limiter for general API routes (/api/tasks, /api/schedule).
 * Accommodates normal interactive assistant usage while safeguarding against request flooding.
 */
export const apiRateLimiter = rateLimit({
    windowMs: env.rateLimit.api.windowMs,
    limit: env.rateLimit.api.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: apiStore,
    handler: createRateLimitHandler("Too many API requests. Please slow down."),
});

/**
 * Utility function for test isolation and suite teardown.
 */
export function resetRateLimitStores(): void {
    guestStore.resetAll?.();
    authStore.resetAll?.();
    apiStore.resetAll?.();
}
