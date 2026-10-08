import type { Request, Response } from "express";
import {
    createGuestAccount,
    findOrCreateGoogleAccount,
    getGoogleAuthUrl,
    getGoogleUserFromCode,
} from "./auth.service.ts";

export async function guestAuth(_req: Request, res: Response): Promise<void> {
    try {
        const session = await createGuestAccount();
        res.status(201).json(session);
    } catch (err) {
        console.error("Error creating guest account:", err);
        res.status(500).json({ error: "Failed to initialize guest session" });
    }
}

export function googleAuth(_req: Request, res: Response): void {
    const authUrl = getGoogleAuthUrl();
    res.redirect(authUrl);
}

export async function googleAuthCallback(req: Request, res: Response): Promise<void> {
    const { code, error } = req.query;

    if (error) {
        console.error("Google OAuth callback query error:", error);
        res.status(400).json({ error: "Invalid authorization request" });
        return;
    }

    if (typeof code !== "string" || code.trim().length === 0) {
        console.error("Missing or invalid authorization code in query");
        res.status(400).json({ error: "Invalid authorization request" });
        return;
    }

    try {
        const userProfile = await getGoogleUserFromCode(code);
        const session = await findOrCreateGoogleAccount(userProfile);
        res.status(200).json(session);
    } catch (err) {
        console.error("Error during Google OAuth callback:", err);
        res.status(401).json({ error: "Authentication failed" });
    }
}
