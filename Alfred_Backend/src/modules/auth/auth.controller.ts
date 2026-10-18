import crypto from "node:crypto";
import type { Request, Response } from "express";
import {
    atomicConsumeTicket,
    atomicConsumeTicketByState,
    createGuestAccount,
    createIssuedTicket,
    createPendingOAuthState,
    consumePendingOAuthState,
    findOrCreateGoogleAccount,
    getGoogleAuthUrl,
    getGoogleUserFromCode,
    renewGuestAccount,
    formatAuthResponse,
} from "./auth.service.ts";
import { OAuthState } from "../../models/oauthState.model.ts";
import { Account } from "../../models/account.model.ts";
import { migrateGuest } from "../../security/guestMigration.ts";
import { env } from "../../config/env.ts";

export function restoreSession(req: Request, res: Response): void {
    // Return the existing token: validating a Google session must not refresh
    // its iat or satisfy the recent-login requirement for account deletion.
    res.json(formatAuthResponse(req.account!, req.headers.authorization!.slice(7).trim()));
}

export async function renewGuestSession(req: Request, res: Response): Promise<void> {
    const header = req.headers.authorization;
    const session = header?.startsWith("Bearer ") ? await renewGuestAccount(header.slice(7).trim()) : null;
    if (!session) { res.status(401).json({ code: "GUEST_SESSION_UNRECOVERABLE", error: "This guest session could not be restored. You can continue as a new guest without signing in." }); return; }
    res.json(session);
}

export async function guestAuth(_req: Request, res: Response): Promise<void> {
    try {
        const session = await createGuestAccount();
        res.status(201).json(session);
    } catch (err) {
        console.error("Error creating guest account:", { name: err instanceof Error ? err.name : "Unknown" });
        res.status(500).json({ error: "Failed to initialize guest session" });
    }
}

const bindingCookie = env.mode === "production" ? "__Host-alfred_oauth" : "alfred_oauth";
const cookieOptions = { httpOnly: true, secure: env.mode === "production", sameSite: "lax" as const, path: "/", maxAge: 600_000 };
function callbackBinding(req: Request): string {
    const entry = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${bindingCookie}=`));
    return entry?.slice(bindingCookie.length + 1) ?? "";
}

export async function prepareOAuth(req: Request, res: Response): Promise<void> {
    const flow = req.body.flow as "browser" | "desktop";
    const state = `${flow === "desktop" ? "desktop_" : ""}${crypto.randomBytes(32).toString("hex")}`;
    await createPendingOAuthState({ state, flow, codeChallenge: req.body.code_challenge,
        codeChallengeMethod: "S256", initiatorId: req.account!._id, initiatorVersion: req.account!.sessionVersion ?? 0 });
    res.json({ state, url: `${env.google.callbackUrl.replace(/\/callback$/, "")}?state=${encodeURIComponent(state)}` });
}

export async function googleAuth(req: Request, res: Response): Promise<void> {
    const state = String(req.query.state ?? "");
    const binding = crypto.randomBytes(32).toString("hex");
    const pending = await OAuthState.findOneAndUpdate({ state, expiresAt: { $gt: new Date() }, callbackBinding: { $exists: false } }, {
        $set: { callbackBinding: crypto.createHash("sha256").update(binding).digest("hex") },
    }, { returnDocument: "after" });
    if (!pending) { res.status(400).json({ error: "Invalid or expired login attempt" }); return; }
    res.cookie(bindingCookie, binding, cookieOptions);
    res.redirect(getGoogleAuthUrl(state, pending.nonce));
}

export async function logout(req: Request, res: Response): Promise<void> {
    await Account.updateOne({ _id: req.account!._id }, { $inc: { sessionVersion: 1 } });
    res.sendStatus(204);
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

    const { code, state, error } = req.query as {
        code?: string;
        state?: string;
        error?: string;
    };

    const cleanState = typeof state === "string" ? state.trim() : "";
    const isDesktopState = cleanState.startsWith("desktop_");

    // 1. Handle OAuth provider errors (e.g. user denied consent)
    if (error) {
        const pendingState = cleanState ? await consumePendingOAuthState(cleanState, callbackBinding(req)) : null;
        if (isDesktopState || pendingState?.flow === "desktop") {
            const desktopErrorUrl = `alfred://auth/callback?auth_error=authorization_rejected&state=${encodeURIComponent(cleanState)}`;
            renderDesktopCallbackPage(res, desktopErrorUrl, "Authentication Cancelled", "You can close this tab and return to Alfred.");
            return;
        }
        res.redirect(`${env.frontendUrl}/?auth_error=authorization_rejected`);
        return;
    }

    // 2. Validate presence of code and state
    if (!code || typeof code !== "string" || code.trim().length === 0 || !cleanState) {
        if (isDesktopState) {
            const desktopErrorUrl = `alfred://auth/callback?auth_error=invalid_request&state=${encodeURIComponent(cleanState)}`;
            renderDesktopCallbackPage(res, desktopErrorUrl, "Invalid Request", "Please return to Alfred and try again.");
            return;
        }
        res.redirect(`${env.frontendUrl}/?auth_error=invalid_request`);
        return;
    }

    const cleanCode = code.trim();

    // 3. Atomically consume the pending OAuth state to guarantee single-use and prevent replay
    const pendingState = await consumePendingOAuthState(cleanState, callbackBinding(req));
    if (!pendingState) {
        if (isDesktopState) {
            const desktopErrorUrl = `alfred://auth/callback?auth_error=invalid_state&state=${encodeURIComponent(cleanState)}`;
            renderDesktopCallbackPage(res, desktopErrorUrl, "Authentication Expired", "Please return to Alfred and try again.");
            return;
        }
        // State was missing, expired, or already used
        res.redirect(`${env.frontendUrl}/?auth_error=invalid_state`);
        return;
    }

    res.clearCookie(bindingCookie, cookieOptions);
    const isDesktopFlow = pendingState.flow === "desktop";

    try {
        // 4. Exchange code for Google identity profile
        const userProfile = await getGoogleUserFromCode(cleanCode, pendingState.nonce);
        const account = await findOrCreateGoogleAccount(userProfile);

        const initiator = await Account.findById(pendingState.initiatorId);
        if (!initiator || (initiator.sessionVersion ?? 0) !== pendingState.initiatorVersion || initiator.migratedTo) {
            throw new Error("Login session is no longer valid");
        }
        let ticket = "";
        const issueTicket = async (session?: import("mongoose").ClientSession) => {
            ticket = await createIssuedTicket({ accountId: account._id, accountVersion: account.sessionVersion ?? 0, codeChallenge: pendingState.codeChallenge,
                flow: pendingState.flow, state: cleanState, ...(session ? { session } : {}) });
        };
        if (initiator.type === "guest") {
            await migrateGuest(initiator._id, account._id, pendingState.initiatorVersion, issueTicket);
        } else {
            await issueTicket();
        }

        // 6. Redirect back to client
        if (isDesktopFlow) {
            const desktopSuccessUrl = `alfred://auth/callback?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(cleanState)}`;
            renderDesktopCallbackPage(
                res,
                desktopSuccessUrl,
                "Authentication Complete",
                "You can close this tab and return to Alfred."
            );
            return;
        }

        res.redirect(`${env.frontendUrl}/?ticket=${encodeURIComponent(ticket)}`);
    } catch (err: unknown) {
        console.error("Google OAuth callback failed");
        if (isDesktopFlow) {
            const desktopFailUrl = `alfred://auth/callback?auth_error=authentication_failed&state=${encodeURIComponent(cleanState)}`;
            renderDesktopCallbackPage(res, desktopFailUrl, "Authentication Failed", "Please return to Alfred and try again.");
            return;
        }
        res.redirect(`${env.frontendUrl}/?auth_error=authentication_failed`);
    }
}

export async function exchangeTicket(req: Request, res: Response): Promise<void> {
    const { ticket, code_verifier } = req.body ?? {};

    if (typeof ticket !== "string" || ticket.trim().length === 0) {
        res.status(400).json({ error: "Invalid or missing authorization ticket" });
        return;
    }

    const session = await atomicConsumeTicket({
        ticket: ticket.trim(),
        codeVerifier: typeof code_verifier === "string" ? code_verifier.trim() : undefined,
    });

    if (!session) {
        res.status(400).json({ error: "Invalid or expired authorization ticket" });
        return;
    }

    res.status(200).json(session);
}

export async function desktopPoll(req: Request, res: Response): Promise<void> {
    const { state, code_verifier } = req.body ?? {};

    if (typeof state !== "string" || !state.trim() || typeof code_verifier !== "string" || !code_verifier.trim()) {
        res.status(400).json({ error: "Invalid state or code_verifier" });
        return;
    }

    const session = await atomicConsumeTicketByState({
        state: state.trim(),
        codeVerifier: code_verifier.trim(),
    });

    if (!session) {
        res.status(404).json({ error: "Pending authentication not completed or expired" });
        return;
    }

    res.status(200).json(session);
}

const DESKTOP_CALLBACK_PATTERN = /^alfred:\/\/auth\/callback(?:\?[a-zA-Z0-9_\-.~%&=]*)?$/;

export function isValidDesktopCallbackUri(uri: unknown): boolean {
    if (typeof uri !== "string" || uri.length > 2048) {
        return false;
    }
    return DESKTOP_CALLBACK_PATTERN.test(uri);
}

export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function serializeForScriptContext(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

export function generateDesktopCallbackHtml(
    customUri: string,
    title: string,
    message: string
): string {
    if (!isValidDesktopCallbackUri(customUri)) {
        throw new Error("Invalid desktop callback redirect URI");
    }

    const safeHtmlTitle = escapeHtml(title);
    const safeHtmlMessage = escapeHtml(message);
    const safeAttrUri = escapeHtml(customUri);
    const safeScriptUri = serializeForScriptContext(customUri);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeHtmlTitle} - Alfred</title>
  <meta http-equiv="refresh" content="0;url=${safeAttrUri}" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 2rem; max-width: 420px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0; margin-bottom: 0.5rem; color: #fafafa; }
    p { font-size: 0.875rem; color: #a1a1aa; margin-bottom: 1.5rem; line-height: 1.4; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff; padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 500; border-radius: 6px; text-decoration: none; transition: background 0.15s; }
    .btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeHtmlTitle}</h1>
    <p>${safeHtmlMessage}</p>
    <a href="${safeAttrUri}" class="btn">Open Alfred</a>
  </div>
  <script>
    window.location.href = ${safeScriptUri};
  </script>
</body>
</html>`;
}

export function renderDesktopCallbackPage(
    res: Response,
    customUri: string,
    title: string,
    message: string
): void {
    if (!isValidDesktopCallbackUri(customUri)) {
        res.status(400).send("<!DOCTYPE html><html><body><h1>Invalid callback redirect</h1></body></html>");
        return;
    }

    const html = generateDesktopCallbackHtml(customUri, title, message);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';");
    res.status(200).send(html);
}
