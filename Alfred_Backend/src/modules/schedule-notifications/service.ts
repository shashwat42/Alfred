import { withTenantWrite } from "../../security/tenantWrite.ts";
import { tenantRepository, assertSafeFields } from "../../security/tenantRepository.ts";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { Schedule } from "../../models/schedule.model.ts";
import { NotificationSettings, NotificationDevice, NotificationDelivery } from "./models.ts";
import { defaultPreferences, eligible, remindersFor, isDue, GRACE_MS, HORIZON_MS, type Preferences, type Platform } from "./policy.ts";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function preferences(accountId: string): Promise<Preferences> {
    const doc = await tenantRepository(NotificationSettings, accountId).findOne();
    return doc ? { destination: doc.destination as Preferences["destination"], enabled: doc.enabled, leadMinutes: doc.leadMinutes, atStart: doc.atStart, timeZone: doc.timeZone, timeZoneMode: doc.timeZoneMode ?? (doc.timeZone === "UTC" ? "automatic" : "manual"), revision: doc.revision, ...(doc.effectiveFrom ? { effectiveFrom: doc.effectiveFrom.getTime() } : {}) } : defaultPreferences();
}
export async function savePreferences(accountId: string, input: Preferences): Promise<boolean> {
    assertSafeFields(input);
    // Older clients omit the mode. Preserve it when they edit other settings;
    // a deliberate zone change from an older client remains a manual override.
    if (!input.timeZoneMode) {
        const previous = await preferences(accountId);
        input = { ...input, timeZoneMode: previous.timeZone === input.timeZone ? previous.timeZoneMode : "manual" };
    }
    // Optimistic concurrency: never overwrite another device's changes silently.
    if (input.revision === 0) {
        try {
            await tenantRepository(NotificationSettings, accountId).create({ ...input, revision: 1, effectiveFrom: new Date(Date.now()) });
            return true;
        } catch (e) { if ((e as { code?: number }).code === 11000) return false; throw e; }
    }
    const result = await tenantRepository(NotificationSettings, accountId).updateOne({ revision: input.revision }, { ...input, revision: input.revision + 1, effectiveFrom: new Date(Date.now()) });
    return result.modifiedCount === 1;
}
export async function registerDevice(accountId: string, secret: string, platform: Platform, token: string, now = Date.now(), pushToken?: string) {
    // token has already passed authMiddleware. Retain only its expiry/version and
    // fingerprint so the background dispatcher never stores a bearer credential.
    const payload = jwt.decode(token);
    const tokenSession = payload && typeof payload !== "string" && payload.sub === accountId && typeof payload.exp === "number" ? payload : null;
    if (pushToken && (platform !== "mobile" || !tokenSession || tokenSession.exp! * 1000 <= now)) throw new Error("Invalid push registration context");
    // Possession of the unguessable installation secret permits account transfer on login.
    await withTenantWrite(accountId, session => NotificationDevice.findOneAndUpdate({ _id: hash(secret) }, { $set: {
        accountId, platform, sessionHash: hash(token), expiresAt: new Date(now + 30 * 86400_000),
        ...(platform === "mobile" ? {
            pushSessionExpiresAt: tokenSession ? new Date(tokenSession.exp! * 1000) : null,
            pushSessionVersion: tokenSession?.version ?? 0,
        } : {}),
        ...(pushToken ? { pushToken } : {}),
    }, ...(platform === "desktop" ? { $unset: { pushToken: "", pushSessionExpiresAt: "", pushSessionVersion: "" } } : {}) }, { upsert: true, ...(session ? { session } : {}) }));
}
export async function device(accountId: string, secret: string, token: string, now = Date.now()) {
    return tenantRepository(NotificationDevice, accountId).findOne({ _id: hash(secret), sessionHash: hash(token), expiresAt: { $gt: new Date(now) } });
}

/** Read-through reconciliation: every sync derives reminders from current schedules.
 * No second schedule store or stale pending queue; edits/deletes apply at claim time.
 * Bounded indexed date scan; keyset pagination avoids dropping busy accounts. */
export async function plan(accountId: string, platform: Platform, now = Date.now(), cursor?: string) {
    const p = await preferences(accountId);
    if (!eligible(p, platform)) return { preferences: p, reminders: [], next: null };
    const firstDate = new Date(now - 2 * 86400_000).toISOString().slice(0, 10);
    const lastDate = new Date(now + HORIZON_MS + (p.leadMinutes + 1440) * 60_000).toISOString().slice(0, 10);
    const [cursorDate, cursorId] = cursor?.split(":") ?? [];
    const schedules = await tenantRepository(Schedule, accountId).find({ date: { $gte: firstDate, $lte: lastDate },
        ...(cursorDate && cursorId ? { $or: [{ date: { $gt: cursorDate } }, { date: cursorDate, _id: { $gt: cursorId } }] } : {}),
    }, { sort: { date: 1, _id: 1 }, limit: 201 });
    const page = schedules.slice(0, 200);
    const last = page.at(-1);
    return { preferences: p, reminders: page.flatMap(s => remindersFor(s, p)).filter(r => r.dueAt >= now - GRACE_MS && r.dueAt <= now + HORIZON_MS), next: schedules.length > 200 && last ? `${last.date}:${last._id}` : null };
}

export async function claim(accountId: string, deviceId: string, platform: Platform, key: string, now = Date.now()) {
    const [scheduleId] = key.split(":");
    if (!scheduleId || !mongoose.isValidObjectId(scheduleId)) return null;
    const schedule = await tenantRepository(Schedule, accountId).findOne({ _id: new mongoose.Types.ObjectId(scheduleId) });
    if (!schedule) return null;
    const p = await preferences(accountId);
    if (!eligible(p, platform)) return null;
    const reminder = remindersFor(schedule, p).find(r => r.key === key && isDue(r, now));
    if (!reminder) return null;
    // Preserve already-consumed reminders across guest transfer without changing
    // their IDs or depending on the now-revoked guest credential.
    const transferred = await tenantRepository(NotificationDelivery, accountId).find({ deviceId, scheduleId: schedule._id, migrationSourceId: { $exists: true } });
    if (transferred.some(row => row._id === hash(`${row.migrationSourceId}:${deviceId}:${key}`))) return null;
    try {
        await tenantRepository(NotificationDelivery, accountId).create({ _id: hash(`${accountId}:${deviceId}:${key}`), deviceId, scheduleId, claimedAt: new Date(now), expiresAt: new Date(reminder.eventAt + 90 * 86400_000) });
        // Fence edits/deletions and preference changes that raced the atomic claim.
        // A changed occurrence remains consumed rather than reviving an old reminder.
        const [current, latest] = await Promise.all([
            tenantRepository(Schedule, accountId).exists({ _id: schedule._id, updatedAt: schedule.updatedAt }),
            preferences(accountId),
        ]);
        if (!current || latest.revision !== p.revision) return null;
        return reminder;
    } catch (e) { if ((e as { code?: number }).code === 11000) return null; throw e; }
}

export async function initializeNotificationIndexes() {
    // Unique claims must exist before the server accepts delivery traffic.
    await Promise.all([NotificationSettings, NotificationDevice, NotificationDelivery].map(async model => { await model.init(); await model.createIndexes(); }));
    await Schedule.createIndexes();
}

export async function unregisterDevice(accountId: string, secret: string, token: string) {
    return tenantRepository(NotificationDevice, accountId).deleteOne({ _id: hash(secret), sessionHash: hash(token) });
}
