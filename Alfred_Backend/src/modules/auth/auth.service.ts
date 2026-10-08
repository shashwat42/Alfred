import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.ts";
import { Account, type IAccount } from "../../models/account.model.ts";

const oauth2Client = new OAuth2Client(
    env.google.clientId,
    env.google.clientSecret,
    env.google.callbackUrl
);

export interface GoogleUserProfile {
    googleId: string;
    email: string | null;
    name: string | null;
    picture: string | null;
}

export interface AuthSessionResponse {
    token: string;
    account: {
        id: string;
        type: "guest" | "user";
        guestId?: string | undefined;
        email?: string | undefined;
        name?: string | undefined;
        picture?: string | undefined;
        createdAt: Date;
    };
}

export function generateAuthToken(account: IAccount): string {
    const payload = {
        sub: account._id.toString(),
        type: account.type,
    };

    return jwt.sign(payload, env.jwt.secret, { expiresIn: "7d" });
}

export function formatAuthResponse(account: IAccount, token: string): AuthSessionResponse {
    return {
        token,
        account: {
            id: account._id.toString(),
            type: account.type,
            guestId: account.guestId,
            email: account.email,
            name: account.name,
            picture: account.picture,
            createdAt: account.createdAt,
        },
    };
}

export async function createGuestAccount(): Promise<AuthSessionResponse> {
    const guestId = crypto.randomUUID();

    const account = await Account.create({
        type: "guest",
        guestId,
    });

    const token = generateAuthToken(account);
    return formatAuthResponse(account, token);
}

export async function findOrCreateGoogleAccount(
    profile: GoogleUserProfile
): Promise<AuthSessionResponse> {
    let account = await Account.findOne({ googleId: profile.googleId });

    if (!account) {
        account = await Account.create({
            type: "user",
            googleId: profile.googleId,
            email: profile.email ?? undefined,
            name: profile.name ?? undefined,
            picture: profile.picture ?? undefined,
        });
    }

    const token = generateAuthToken(account);
    return formatAuthResponse(account, token);
}

export function getGoogleAuthUrl(): string {
    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["openid", "email", "profile"],
    });
}

export async function getGoogleUserFromCode(code: string): Promise<GoogleUserProfile> {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.id_token) {
        throw new Error("Missing ID token from Google OAuth response");
    }

    const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.google.clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
        throw new Error("Invalid ID token payload received from Google");
    }

    return {
        googleId: payload.sub,
        email: payload.email ?? null,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
    };
}
