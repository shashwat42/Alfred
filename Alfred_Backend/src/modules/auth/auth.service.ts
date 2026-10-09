import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../../config/env.ts";
import { Account, type IAccount } from "../../models/account.model.ts";
import { AuthTicket } from "../../models/authTicket.model.ts";
import { OAuthState, type IOAuthState } from "../../models/oauthState.model.ts";

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

interface LegacyHandoffData {
    session: AuthSessionResponse;
    expiresAt: number;
    consumedAt?: number;
}
const legacyHandoffStore = new Map<string, LegacyHandoffData>();

export function createHandoffTicket(session: AuthSessionResponse): string {
    const ticket = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 60 * 1000;
    legacyHandoffStore.set(ticket, { session, expiresAt });
    return ticket;
}

export function consumeHandoffTicket(ticket: string): AuthSessionResponse | null {
    if (!ticket || typeof ticket !== "string") return null;
    const data = legacyHandoffStore.get(ticket);
    if (!data || Date.now() > data.expiresAt) {
        if (data) legacyHandoffStore.delete(ticket);
        return null;
    }
    if (!data.consumedAt) {
        data.consumedAt = Date.now();
        data.expiresAt = Math.min(data.expiresAt, Date.now() + 15000);
        setTimeout(() => legacyHandoffStore.delete(ticket), 15000).unref();
    }
    return data.session;
}

/**
 * Creates and persists a pending OAuth state document in MongoDB.
 * TTL is 10 minutes.
 */
export async function createPendingOAuthState(params: {
    state: string;
    codeChallenge?: string | undefined;
    codeChallengeMethod?: string | undefined;
    flow: "browser" | "desktop";
}): Promise<IOAuthState> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const doc: Record<string, unknown> = {
        state: params.state,
        flow: params.flow,
        expiresAt,
    };
    if (params.codeChallenge) {
        doc.codeChallenge = params.codeChallenge;
    }
    if (params.codeChallengeMethod) {
        doc.codeChallengeMethod = params.codeChallengeMethod;
    }
    return await OAuthState.create(doc);
}

/**
 * Atomically consumes and deletes a pending OAuth state document to guarantee single-use.
 * Returns the state document if valid and unexpired, or null otherwise.
 */
export async function consumePendingOAuthState(state: string): Promise<IOAuthState | null> {
    if (!state || typeof state !== "string") {
        return null;
    }

    return await OAuthState.findOneAndDelete({
        state: state.trim(),
        expiresAt: { $gt: new Date() },
    });
}

/**
 * Creates a single-use authorization ticket in MongoDB with a strict 90-second TTL.
 * Zero JWT tokens or secrets are stored in this record.
 */
export async function createIssuedTicket(params: {
    accountId: mongoose.Types.ObjectId;
    codeChallenge?: string | undefined;
    flow: "browser" | "desktop";
}): Promise<string> {
    const ticket = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 90 * 1000); // 90 seconds TTL

    const doc: Record<string, unknown> = {
        ticket,
        accountId: params.accountId,
        flow: params.flow,
        status: "issued",
        expiresAt,
    };
    if (params.codeChallenge) {
        doc.codeChallenge = params.codeChallenge;
    }

    await AuthTicket.create(doc);
    return ticket;
}

/**
 * Atomically consumes an issued authorization ticket in MongoDB.
 * For desktop flow: computes the SHA-256 base64url challenge of codeVerifier and enforces match
 * directly in the database atomic filter so an invalid verifier never consumes the ticket.
 * On success, fetches the account and mints a fresh JWT session.
 */
export async function atomicConsumeTicket(params: {
    ticket: string;
    codeVerifier?: string | undefined;
}): Promise<AuthSessionResponse | null> {
    const { ticket, codeVerifier } = params;
    if (!ticket || typeof ticket !== "string") {
        return null;
    }

    const cleanTicket = ticket.trim();

    // Check existing ticket metadata without modifying it to identify the flow
    const existingTicket = await AuthTicket.findOne({
        ticket: cleanTicket,
        expiresAt: { $gt: new Date() },
    });

    if (!existingTicket || existingTicket.status !== "issued") {
        return null;
    }

    const filter: Record<string, unknown> = {
        ticket: cleanTicket,
        status: "issued",
        expiresAt: { $gt: new Date() },
    };

    if (existingTicket.flow === "desktop") {
        if (!codeVerifier || typeof codeVerifier !== "string") {
            return null;
        }

        // Compute S256 challenge from the submitted code_verifier
        const computedChallenge = crypto
            .createHash("sha256")
            .update(codeVerifier.trim())
            .digest("base64url");

        filter.flow = "desktop";
        filter.codeChallenge = computedChallenge;
    } else {
        filter.flow = "browser";
    }

    // Atomic consumption: only updates if challenge and expiration match
    const consumed = await AuthTicket.findOneAndUpdate(
        filter,
        {
            $set: {
                status: "consumed",
                consumedAt: new Date(),
            },
        },
        { returnDocument: "before" }
    );

    if (!consumed) {
        return null;
    }

    const account = await Account.findById(consumed.accountId);
    if (!account) {
        return null;
    }

    const token = generateAuthToken(account);
    return formatAuthResponse(account, token);
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
): Promise<IAccount> {
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

    return account;
}

export function createOAuth2Client(): OAuth2Client {
    return new OAuth2Client(
        env.google.clientId,
        env.google.clientSecret,
        env.google.callbackUrl
    );
}

export function getGoogleAuthUrl(state?: string): string {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["openid", "email", "profile"],
        ...(state ? { state } : {}),
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
