import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { preferences, savePreferences, registerDevice, device, plan, claim, unregisterDevice } from "./service.ts";

export const preferenceSchema = z.object({
    destination: z.enum(["mobile", "desktop", "both"]), enabled: z.boolean(),
    leadMinutes: z.number().int().min(0).max(10080), atStart: z.boolean(),
    timeZone: z.string().max(100).refine(zone => { try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; } }),
    revision: z.number().int().min(0),
}).strict();
const secretSchema = z.string().regex(/^[a-f0-9]{64}$/);
const registrationSchema = z.object({ secret: secretSchema, platform: z.enum(["mobile", "desktop"]) }).strict();
const keySchema = z.string().regex(/^[a-f0-9]{24}:\d{10,16}:(lead|start)$/);
const router = Router();
router.use(authMiddleware);
const token = (req: Request) => req.headers.authorization!.slice(7).trim();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch { res.status(503).json({ error: "Schedule notifications are temporarily unavailable." }); }
};
router.get("/preferences", run(async (req, res) => res.json(await preferences(req.accountId!))));
router.put("/preferences", run(async (req, res) => {
    const parsed = preferenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid schedule notification preferences." });
    if (!await savePreferences(req.accountId!, parsed.data)) return res.status(409).json({ error: "Preferences changed on another device. Reload and try again.", preferences: await preferences(req.accountId!) });
    return res.json(await preferences(req.accountId!));
}));
router.post("/devices", run(async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid device registration." });
    await registerDevice(req.accountId!, parsed.data.secret, parsed.data.platform, token(req));
    return res.sendStatus(204);
}));
router.delete("/devices", run(async (req, res) => {
    const parsed = z.object({ secret: secretSchema }).strict().safeParse(req.body);
    if (!parsed.success) return res.sendStatus(400);
    await unregisterDevice(req.accountId!, parsed.data.secret, token(req));
    return res.sendStatus(204);
}));
router.post("/sync", run(async (req, res) => {
    const parsed = z.object({ secret: secretSchema, cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[a-f0-9]{24}$/).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.sendStatus(400);
    const d = await device(req.accountId!, parsed.data.secret, token(req));
    if (!d) return res.sendStatus(403);
    return res.json(await plan(req.accountId!, d.platform as "mobile" | "desktop", Date.now(), parsed.data.cursor));
}));
router.post("/claim", run(async (req, res) => {
    const parsed = z.object({ secret: secretSchema, key: keySchema }).strict().safeParse(req.body);
    if (!parsed.success) return res.sendStatus(400);
    const d = await device(req.accountId!, parsed.data.secret, token(req));
    if (!d) return res.sendStatus(403);
    const result = await claim(req.accountId!, d._id, d.platform as "mobile" | "desktop", parsed.data.key);
    return result ? res.json(result) : res.sendStatus(204);
}));
export default router;
