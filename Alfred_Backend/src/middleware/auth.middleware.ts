import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config/env.ts";
import { Account, type AccountType } from "../models/account.model.ts";

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
        const decoded = jwt.verify(token, env.jwt.secret) as jwt.JwtPayload;

        const sub = decoded.sub;
        if (typeof sub !== "string" || !mongoose.isValidObjectId(sub)) {
            res.status(401).json({ error: "Invalid token subject" });
            return;
        }

        const account = await Account.findById(sub);
        if (!account) {
            res.status(401).json({ error: "Account not found" });
            return;
        }

        req.accountId = account._id.toString();
        req.account = account;

        next();
    } catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
}
