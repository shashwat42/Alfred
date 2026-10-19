import { Router } from "express";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { authState, login, logout, requireAdmin, sameOrigin, setPassword, startGoogle } from "./auth.ts";
import { createMetrics } from "./metrics.ts";

export function createMonitorRouter(isDraining: () => boolean) {
    const router = Router();
    const metrics = createMetrics(isDraining);
    const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false });
    const googleLimit = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false });
    const readLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
    // Bound expensive password hashing globally too, not only per source IP.
    let hashing = false;
    const passwordGuard: express.RequestHandler = async (req, res, next) => {
        if (hashing) { res.status(429).json({ error: "Another login is in progress. Retry shortly." }); return; }
        hashing = true;
        try { if (req.path === "/password") await setPassword(req, res); else await login(req, res); }
        catch (error) { next(error); }
        finally { hashing = false; }
    };
    router.use((_req, res, next) => {
        res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
        next();
    });
    const file = (name: string) => fileURLToPath(new URL(`./public/${name}`, import.meta.url));
    router.get(["/", "/dashboard"], (_req, res) => res.sendFile(file("index.html")));
    router.get("/app.js", (_req, res) => res.sendFile(file("app.js")));
    router.get("/style.css", (_req, res) => res.sendFile(file("style.css")));
    router.get("/google", googleLimit, startGoogle);
    router.get("/auth-state", readLimit, authState);
    router.post(["/login", "/password"], authLimit, sameOrigin, express.json({ limit: "2kb" }), passwordGuard);
    router.post("/logout", sameOrigin, logout);
    router.get("/metrics", readLimit, requireAdmin, async (_req, res) => { res.json(await metrics.get()); });
    return router;
}
