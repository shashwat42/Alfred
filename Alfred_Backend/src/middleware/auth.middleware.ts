import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config/env.ts";
import { Account, type AccountType } from "../models/account.model.ts";

export type Principal =
    | { kind: "user"; accountId: string; googleSub: string | undefined }
    | { kind: "guest"; accountId: string; guestId: string };

export interface AlfredTokenPayload {
    sub: string;
    type: AccountType;
}

export async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Authorization token required" });
        return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        res.status(401).json({ error: "Authorization token required" });
        return;
    }

    try {
        const decoded = jwt.verify(token, env.jwt.secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
        const legacy = decoded.iss === undefined && decoded.aud === undefined
            && Date.now() < env.jwt.legacyAcceptUntil
            && typeof decoded.iat === "number" && typeof decoded.exp === "number"
            && decoded.iat * 1000 < env.jwt.legacyAcceptUntil
            && decoded.exp - decoded.iat <= 7 * 86400;
        if (!legacy && (decoded.iss !== "alfred" || decoded.aud !== "alfred-api")) {
            res.status(401).json({ error: "Invalid token context" });
            return;
        }

        const sub = decoded.sub;
        if (typeof sub !== "string" || !mongoose.isValidObjectId(sub)) {
            res.status(401).json({ error: "Invalid token subject" });
            return;
        }

        const account = await Account.findById(sub);
        if (!account || account.migratedTo || decoded.type !== account.type || (decoded.version ?? 0) !== (account.sessionVersion ?? 0) || typeof decoded.exp !== "number") {
            res.status(401).json({ error: "Account not found" });
            return;
        }

        if ((account.type === "guest" && (!account.guestId || account.googleId)) ||
            (account.type === "user" && (!account.googleId || account.guestId))) {
            res.status(401).json({ error: "Invalid account identity" });
            return;
        }
        req.principal = account.type === "guest"
            ? { kind: "guest", accountId: String(account._id), guestId: account.guestId! }
            : { kind: "user", accountId: String(account._id), googleSub: account.googleId };
        req.accountId = account._id.toString();
        req.account = account;

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error instanceof jwt.NotBeforeError) {
            res.status(401).json({ error: "Invalid or expired token" });
        } else {
            res.status(503).json({ code: "BACKEND_UNAVAILABLE", error: "The account service is temporarily unavailable. Please retry." });
        }
    }
}
