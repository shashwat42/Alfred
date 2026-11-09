import { requireCloudSync } from "../../middleware/cloudStorage.middleware.ts";
import { sendPolicyError } from "../../security/errors.ts";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { preferences, savePreferences, registerDevice, device, listDevices, manageDevice, plan, claim, unregisterDevice } from "./service.ts";
import { activeRevocations } from "../../security/deviceSessions.ts";

const secretSchema = z.string().regex(/^[a-f0-9]{64}$/);
const deviceNameSchema = z.string().trim().min(1).max(80).refine(value => !/\p{Cc}/u.test(value));
export const preferenceSchema = z.object({
    destination: z.enum(["mobile", "desktop", "both"]), enabled: z.boolean(),
    alertType: z.enum(["notification", "alarm"]).optional(),
    deviceId: secretSchema.optional(),
    leadMinutes: z.number().int().min(0).max(10080), atStart: z.boolean(),
    timeZone: z.string().max(100).refine(zone => { try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; } }),
    timeZoneMode: z.enum(["automatic", "manual"]).optional(),
    revision: z.number().int().min(0),
}).strict();
const registrationSchema = z.object({
    secret: secretSchema, platform: z.enum(["mobile", "desktop"]),
    name: deviceNameSchema.optional(),
    pushToken: z.string().min(20).max(4096).regex(/^[\x21-\x7e]+$/).optional(),
}).strict()
    .refine(value => !value.pushToken || value.platform === "mobile");
const keySchema = z.string().regex(/^[a-f0-9]{24}:\d{10,16}:(lead|start)$/);
const router = Router();
router.use(authMiddleware, requireCloudSync);
const token = (req: Request) => req.headers.authorization!.slice(7).trim();
const accountDevices = (req: Request, secret?: string) =>
    listDevices(req.accountId!, req.account!.sessionVersion ?? 0, secret, Date.now(), activeRevocations(req.account!));
const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch (error) { if (sendPolicyError(error, res)) return; res.status(503).json({ error: "Schedule notifications are temporarily unavailable." }); }
};
router.get("/preferences", run(async (req, res) => res.json(await preferences(req.accountId!))));
router.put("/preferences", run(async (req, res) => {
    const parsed = preferenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid schedule notification preferences." });
    if (parsed.data.deviceId) {
        const devices = await accountDevices(req);
        if (!devices.some(device => device.id === parsed.data.deviceId)) return res.status(422).json({ error: "That device is no longer signed in." });
    }
    if (!await savePreferences(req.accountId!, parsed.data)) return res.status(409).json({ error: "Preferences changed on another device. Reload and try again.", preferences: await preferences(req.accountId!) });
    return res.json(await preferences(req.accountId!));
}));
router.post("/devices/list", run(async (req, res) => {
    const parsed = z.object({ secret: secretSchema.optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.sendStatus(400);
    return res.json(await accountDevices(req, parsed.data.secret));
}));
router.patch("/devices/:id", run(async (req, res) => {
    const id = secretSchema.safeParse(req.params.id);
    const parsed = z.object({ name: deviceNameSchema }).strict().safeParse(req.body);
    if (!id.success || !parsed.success) return res.sendStatus(400);
    return res.sendStatus(await manageDevice(req.account!, id.data, parsed.data.name) === "done" ? 204 : 404);
}));
router.delete("/devices/:id", run(async (req, res) => {
    const id = secretSchema.safeParse(req.params.id);
    if (!id.success) return res.sendStatus(400);
    const result = await manageDevice(req.account!, id.data);
    if (result === "shared") return res.status(409).json({ error: "This device shares an older sign-in with another device. Sign in again on the device you want to remove and retry." });
    return res.sendStatus(result === "done" ? 204 : 404);
}));
router.post("/devices", run(async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid device registration." });
    await registerDevice(req.accountId!, parsed.data.secret, parsed.data.platform, token(req), Date.now(), parsed.data.pushToken, parsed.data.name);
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
    return res.json(await plan(req.accountId!, d.platform as "mobile" | "desktop", Date.now(), parsed.data.cursor, d._id));
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
