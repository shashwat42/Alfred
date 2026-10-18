import { Router } from "express";
import jwt from "jsonwebtoken";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { env } from "../../config/env.ts";
import { accountState, completeOnboarding, deleteAccount } from "../../security/accountLifecycle.ts";
import { aiUsage } from "../../security/aiUsage.ts";
const router = Router();
router.use(authMiddleware);
router.get("/", async (req, res) => { res.json({ ...await accountState(req.accountId!), ai: await aiUsage(req.accountId!) }); });
router.put("/onboarding", async (req, res) => {
    if (req.body?.completed !== true || Object.keys(req.body).length !== 1) { res.status(400).json({ error: "Expected completed: true" }); return; }
    await completeOnboarding(req.accountId!); res.sendStatus(204);
});
router.delete("/", async (req, res) => {
    if (req.body?.confirmation !== "DELETE" || Object.keys(req.body).length !== 1) { res.status(400).json({ error: "Type DELETE to confirm account deletion." }); return; }
    const claims = jwt.verify(req.headers.authorization!.slice(7), env.jwt.secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (req.account!.type === "user" && (typeof claims.iat !== "number" || Date.now() - claims.iat * 1000 > 600_000)) {
        res.status(403).json({ code: "RECENT_LOGIN_REQUIRED", error: "Sign in with Google again, then delete your account within ten minutes." }); return;
    }
    await deleteAccount(req.accountId!); res.sendStatus(204);
});
export default router;
