import type { Request, Response } from "express";
import {
    consumeHandoffTicket,
    createGuestAccount,
    createHandoffTicket,
    findOrCreateGoogleAccount,
    getGoogleAuthUrl,
    getGoogleUserFromCode,
} from "./auth.service.ts";
import { env } from "../../config/env.ts";

export async function guestAuth(_req: Request, res: Response): Promise<void> {
    try {
        const session = await createGuestAccount();
        res.status(201).json(session);
    } catch (err) {
        console.error("Error creating guest account:", err);
        res.status(500).json({ error: "Failed to initialize guest session" });
    }
}

// Cache recent code exchanges (or in-flight promises) for 30s to prevent invalid_grant if browser/extensions duplicate callback requests
type CacheEntry = 
    | { status: "pending"; promise: Promise<string>; expiresAt: number }
    | { status: "resolved"; ticket: string; expiresAt: number };

const codeExchangeCache = new Map<string, CacheEntry>();

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of codeExchangeCache.entries()) {
        if (v.expiresAt < now) codeExchangeCache.delete(k);
    }
}, 60000).unref();

export function googleAuth(_req: Request, res: Response): void {
    const authUrl = getGoogleAuthUrl();
    res.redirect(authUrl);
}

export async function googleAuthCallback(req: Request, res: Response): Promise<void> {
    // Ignore browser/extension prefetch requests so single-use code is not consumed prematurely
    if (
        req.headers["purpose"] === "prefetch" ||
        req.headers["sec-purpose"] === "prefetch" ||
        req.headers["x-purpose"] === "preview"
    ) {
        res.status(204).end();
        return;
    }

    const { code, error } = req.query;

    if (error) {
        console.error("Google OAuth callback query error:", error);
        res.redirect(`${env.frontendUrl}/?auth_error=authorization_rejected`);
        return;
    }

    if (typeof code !== "string" || code.trim().length === 0) {
        console.error("Missing or invalid authorization code in query");
        res.redirect(`${env.frontendUrl}/?auth_error=invalid_request`);
        return;
    }

    const cleanCode = code.trim();

    // If this code was already processed (or is currently being processed) in the last 30s, reuse the ticket
    const cached = codeExchangeCache.get(cleanCode);
    if (cached && Date.now() < cached.expiresAt) {
        if (cached.status === "resolved") {
            res.redirect(`${env.frontendUrl}/?ticket=${encodeURIComponent(cached.ticket)}`);
            return;
        } else {
            try {
                const ticket = await cached.promise;
                res.redirect(`${env.frontendUrl}/?ticket=${encodeURIComponent(ticket)}`);
            } catch {
                res.redirect(`${env.frontendUrl}/?auth_error=authentication_failed`);
            }
            return;
        }
    }

    const exchangePromise = (async () => {
        const userProfile = await getGoogleUserFromCode(cleanCode);
        const session = await findOrCreateGoogleAccount(userProfile);
        const ticket = createHandoffTicket(session);
        codeExchangeCache.set(cleanCode, { status: "resolved", ticket, expiresAt: Date.now() + 30000 });
        return ticket;
    })();

    codeExchangeCache.set(cleanCode, { status: "pending", promise: exchangePromise, expiresAt: Date.now() + 30000 });

    try {
        const ticket = await exchangePromise;
        res.redirect(`${env.frontendUrl}/?ticket=${encodeURIComponent(ticket)}`);
    } catch (err: unknown) {
        codeExchangeCache.delete(cleanCode);
        const isInvalidGrant =
            typeof err === "object" &&
            err !== null &&
            (String((err as { message?: string }).message).includes("invalid_grant") ||
             String((err as { response?: { data?: { error?: string } } }).response?.data?.error).includes("invalid_grant"));

        if (isInvalidGrant) {
            console.warn("Google OAuth authorization code expired or already used. Redirecting to frontend.");
            res.redirect(`${env.frontendUrl}/?auth_error=code_expired`);
            return;
        }

        console.error("Error during Google OAuth callback:", err);
        res.redirect(`${env.frontendUrl}/?auth_error=authentication_failed`);
    }
}

export function exchangeTicket(req: Request, res: Response): void {
    const { ticket } = req.body ?? {};

    if (typeof ticket !== "string" || ticket.trim().length === 0) {
        res.status(400).json({ error: "Invalid or missing authorization ticket" });
        return;
    }

    const session = consumeHandoffTicket(ticket.trim());
    if (!session) {
        res.status(400).json({ error: "Invalid or expired authorization ticket" });
        return;
    }

    res.status(200).json(session);
}
