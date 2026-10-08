import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.ts";
import { Account, type IAccount } from "../../models/account.model.ts";


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

interface HandoffData {
    session: AuthSessionResponse;
    expiresAt: number;
    consumedAt?: number;
}

// In-memory handoff ticket store: ticket -> { session, expiresAt, consumedAt }
// 60-second TTL, with 15-second grace window after first consumption to tolerate StrictMode / duplicate requests.
const handoffStore = new Map<string, HandoffData>();

// Periodic cleanup of expired tickets every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [ticket, data] of handoffStore.entries()) {
        if (data.expiresAt < now) {
            handoffStore.delete(ticket);
        }
    }
}, 60000).unref();

export function createHandoffTicket(session: AuthSessionResponse): string {
    const ticket = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 60 * 1000; // 60 seconds TTL
    handoffStore.set(ticket, { session, expiresAt });
    return ticket;
}

export function consumeHandoffTicket(ticket: string): AuthSessionResponse | null {
    if (!ticket || typeof ticket !== "string") {
        return null;
    }

    const data = handoffStore.get(ticket);
    if (!data) {
        return null;
    }

    const now = Date.now();
    if (now > data.expiresAt) {
        handoffStore.delete(ticket);
        return null;
    }

    // On first consumption, allow a 15-second grace period for React StrictMode / parallel mounts
    if (!data.consumedAt) {
        data.consumedAt = now;
        data.expiresAt = Math.min(data.expiresAt, now + 15000);
        setTimeout(() => {
            handoffStore.delete(ticket);
        }, 15000).unref();
    }

    return data.session;
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

export function createOAuth2Client(): OAuth2Client {
    return new OAuth2Client(
        env.google.clientId,
        env.google.clientSecret,
        env.google.callbackUrl
    );
}

export function getGoogleAuthUrl(): string {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["openid", "email", "profile"],
    });
}

export async function getGoogleUserFromCode(code: string): Promise<GoogleUserProfile> {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken({
        code,
        redirect_uri: env.google.callbackUrl,
    });

    if (!tokens.id_token) {
        throw new Error("Missing ID token from Google OAuth response");
    }

    const ticket = await client.verifyIdToken({
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
