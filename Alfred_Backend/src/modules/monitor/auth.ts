import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { OAuth2Client, CodeChallengeMethod, type TokenPayload } from "google-auth-library";
import { env } from "../../config/env.ts";
import { observeService } from "./activity.ts";

export const ADMIN_EMAIL = "singhshashwat.dev@gmail.com";
const ID = "dashboard-owner";
const derive = promisify(scrypt);
const random = () => randomBytes(32).toString("base64url");
const digest = (s: string) => createHash("sha256").update(s).digest("base64url");
const schema = new mongoose.Schema({
    _id: String, googleSub: { type: String, required: true }, passwordHash: String,
    version: String, proofHash: String, proofExpires: Date,
}, { versionKey: false });
export const MonitorAdmin = mongoose.model("MonitorAdmin", schema);
const secure = env.mode === "production";
const cookieName = (kind: string) => `${secure ? "__Host-" : ""}alfred_monitor_${kind}`;
const cookieOptions = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
function cookie(req: Request, kind: string) {
    return req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName(kind)}=`))?.slice(cookieName(kind).length + 1) ?? "";
}
function sign(payload: object, audience: string, seconds: number) {
    return jwt.sign(payload, env.jwt.secret, { issuer: "alfred-monitor", audience, expiresIn: seconds, algorithm: "HS256" });
}
function verify(token: string, audience: string) {
    try { return jwt.verify(token, env.jwt.secret, { algorithms: ["HS256"], issuer: "alfred-monitor", audience }) as jwt.JwtPayload; }
    catch { return null; }
}
export async function hashPassword(password: string) {
    const salt = random();
    const key = await derive(password, salt, 64) as Buffer;
    return `${salt}:${key.toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
    const [salt, hex] = stored.split(":");
    if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
    const key = await derive(password, salt, 64) as Buffer;
    return timingSafeEqual(key, Buffer.from(hex, "hex"));
}
export function validPassword(value: unknown): value is string {
    return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
export function isOwner(payload: Pick<TokenPayload, "email" | "email_verified" | "sub" | "nonce"> | undefined, nonce: string) {
    return Boolean(payload?.sub && payload.email_verified === true && payload.email === ADMIN_EMAIL && payload.nonce === nonce);
}
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
    const expected = new URL(env.google.callbackUrl).origin;
    if (req.get("origin") !== expected || !req.is("application/json")) {
        res.status(403).json({ error: "A same-origin JSON request is required." }); return;
    }
    next();
}
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const payload = verify(cookie(req, "session"), "session");
    if (!payload || typeof payload.version !== "string") { res.status(401).json({ error: "Sign in to the monitor." }); return; }
    const admin = await MonitorAdmin.exists({ _id: ID, version: payload.version, passwordHash: { $type: "string" } });
    if (!admin) { res.status(401).json({ error: "Your admin session expired." }); return; }
    next();
}
function session(res: Response, version: string) {
    res.cookie(cookieName("session"), sign({ version }, "session", 8 * 3600), { ...cookieOptions, maxAge: 8 * 3600_000 });
}
export function startGoogle(_req: Request, res: Response) {
    const state = `monitor_${random()}`, nonce = random(), verifier = random();
    res.cookie(cookieName("oauth"), sign({ state, nonce, verifier }, "oauth", 600), { ...cookieOptions, maxAge: 600_000 });
    const client = new OAuth2Client(env.google.clientId, env.google.clientSecret, env.google.callbackUrl);
    res.redirect(client.generateAuthUrl({ state, nonce, scope: ["openid", "email"], prompt: "select_account",
        login_hint: ADMIN_EMAIL, code_challenge: digest(verifier), code_challenge_method: CodeChallengeMethod.S256 }));
}
export async function finishGoogle(req: Request, res: Response) {
    const pending = verify(cookie(req, "oauth"), "oauth");
    res.clearCookie(cookieName("oauth"), cookieOptions);
    if (!pending || typeof pending.nonce !== "string" || typeof pending.verifier !== "string" || pending.state !== req.query.state || typeof req.query.code !== "string") {
        res.redirect("/monitor?error=verification"); return;
    }
    const started = Date.now();
    try {
        const client = new OAuth2Client({ clientId: env.google.clientId, clientSecret: env.google.clientSecret,
            redirectUri: env.google.callbackUrl, transporterOptions: { timeout: 8000 } });
        const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: pending.verifier });
        if (!tokens.id_token) throw new Error("Missing identity");
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.google.clientId });
        const payload = ticket.getPayload();
        if (!isOwner(payload, pending.nonce)) throw new Error("Not owner");
        const proof = random();
        // Pin the verified Google subject; a callback never changes the password.
        const admin = await MonitorAdmin.findOneAndUpdate({ _id: ID, googleSub: payload!.sub }, {
            $set: { proofHash: digest(proof), proofExpires: new Date(Date.now() + 600_000) },
            $setOnInsert: { googleSub: payload!.sub },
        }, { upsert: true, returnDocument: "after" });
        if (!admin) throw new Error("Not owner");
        res.cookie(cookieName("proof"), proof, { ...cookieOptions, maxAge: 600_000 });
        observeService("google", true, started); res.redirect("/monitor?verified=1");
    } catch {
        observeService("google", false, started); res.redirect("/monitor?error=verification");
    }
}
export async function authState(req: Request, res: Response) {
    const proof = cookie(req, "proof");
    const verified = Boolean(proof && await MonitorAdmin.exists({ _id: ID, proofHash: digest(proof), proofExpires: { $gt: new Date() } }));
    res.json({ email: ADMIN_EMAIL, verified });
}
export async function setPassword(req: Request, res: Response) {
    if (!validPassword(req.body?.password)) { res.status(400).json({ error: "Use a password with 12–128 characters." }); return; }
    const proof = cookie(req, "proof");
    if (!proof || !await MonitorAdmin.exists({ _id: ID, proofHash: digest(proof), proofExpires: { $gt: new Date() } })) {
        res.status(403).json({ error: "Verify your Google account first." }); return;
    }
    const passwordHash = await hashPassword(req.body.password), version = random();
    const updated = await MonitorAdmin.findOneAndUpdate({ _id: ID, proofHash: digest(proof), proofExpires: { $gt: new Date() } }, {
        $set: { passwordHash, version }, $unset: { proofHash: "", proofExpires: "" },
    });
    if (!updated) { res.status(403).json({ error: "Verification expired or already used." }); return; }
    res.clearCookie(cookieName("proof"), cookieOptions); session(res, version); res.json({ ok: true });
}
export async function login(req: Request, res: Response) {
    if (!validPassword(req.body?.password)) { res.status(401).json({ error: "Invalid password or setup incomplete." }); return; }
    const admin = await MonitorAdmin.findById(ID).lean();
    // Run scrypt even before setup so the missing account is not a fast path.
    const stored = admin?.passwordHash ?? `${"unconfigured"}:${"0".repeat(128)}`;
    const matches = await checkPassword(req.body.password, stored);
    if (!matches || !admin?.version) { res.status(401).json({ error: "Invalid password or setup incomplete." }); return; }
    session(res, admin.version); res.json({ ok: true });
}
export async function logout(req: Request, res: Response) {
    const payload = verify(cookie(req, "session"), "session");
    if (typeof payload?.version === "string") await MonitorAdmin.updateOne({ _id: ID, version: payload.version }, { $set: { version: random() } });
    res.clearCookie(cookieName("session"), cookieOptions); res.clearCookie(cookieName("proof"), cookieOptions); res.json({ ok: true });
}
