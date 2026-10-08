import type { Request, Response } from "express";
import {
    consumeHandoffTicket,
    createGuestAccount,
    createHandoffTicket,
    findOrCreateGoogleAccount,
    getGoogleAuthUrl,
    getGoogleUserFromCode,
} from "./auth.service.ts";

const FRONTEND_URL = "http://localhost:5173";

export async function guestAuth(_req: Request, res: Response): Promise<void> {
    try {
        const session = await createGuestAccount();
        res.status(201).json(session);
    } catch (err) {
        console.error("Error creating guest account:", err);
        res.status(500).json({ error: "Failed to initialize guest session" });
    }
}

// Cache recent code exchanges for 30s to prevent invalid_grant if browser/extensions duplicate callback requests
const codeExchangeCache = new Map<string, { ticket: string; expiresAt: number }>();

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
        res.redirect(`${FRONTEND_URL}/?auth_error=authorization_rejected`);
        return;
    }

    if (typeof code !== "string" || code.trim().length === 0) {
        console.error("Missing or invalid authorization code in query");
        res.redirect(`${FRONTEND_URL}/?auth_error=invalid_request`);
        return;
    }

    const cleanCode = code.trim();

    // If this code was already processed in the last 30s, reuse the ticket
    const cached = codeExchangeCache.get(cleanCode);
    if (cached && Date.now() < cached.expiresAt) {
        res.redirect(`${FRONTEND_URL}/?ticket=${encodeURIComponent(cached.ticket)}`);
        return;
    }

    try {
        const userProfile = await getGoogleUserFromCode(cleanCode);
        const session = await findOrCreateGoogleAccount(userProfile);
        const ticket = createHandoffTicket(session);

        codeExchangeCache.set(cleanCode, { ticket, expiresAt: Date.now() + 30000 });

        res.redirect(`${FRONTEND_URL}/?ticket=${encodeURIComponent(ticket)}`);
    } catch (err: unknown) {
        const isInvalidGrant =
            typeof err === "object" &&
            err !== null &&
            (String((err as { message?: string }).message).includes("invalid_grant") ||
             String((err as { response?: { data?: { error?: string } } }).response?.data?.error).includes("invalid_grant"));

        if (isInvalidGrant) {
            console.warn("Google OAuth authorization code expired or already used. Redirecting to frontend.");
            res.redirect(`${FRONTEND_URL}/?auth_error=code_expired`);
            return;
        }

        console.error("Error during Google OAuth callback:", err);
        res.redirect(`${FRONTEND_URL}/?auth_error=authentication_failed`);
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
