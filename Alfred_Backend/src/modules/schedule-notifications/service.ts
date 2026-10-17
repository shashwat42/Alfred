import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { Schedule } from "../../models/schedule.model.ts";
import { NotificationSettings, NotificationDevice, NotificationDelivery } from "./models.ts";
import { defaultPreferences, eligible, remindersFor, isDue, GRACE_MS, HORIZON_MS, type Preferences, type Platform } from "./policy.ts";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function preferences(accountId: string): Promise<Preferences> {
    const doc = await NotificationSettings.findOne({ accountId }).lean();
    return doc ? { destination: doc.destination as Preferences["destination"], enabled: doc.enabled, leadMinutes: doc.leadMinutes, atStart: doc.atStart, timeZone: doc.timeZone, revision: doc.revision, ...(doc.effectiveFrom ? { effectiveFrom: doc.effectiveFrom.getTime() } : {}) } : defaultPreferences();
}
export async function savePreferences(accountId: string, input: Preferences): Promise<boolean> {
    // Optimistic concurrency: never overwrite another device's changes silently.
    if (input.revision === 0) {
        try {
            await NotificationSettings.create({ ...input, accountId, revision: 1, effectiveFrom: new Date(Date.now()) });
            return true;
        } catch (e) { if ((e as { code?: number }).code === 11000) return false; throw e; }
    }
    const result = await NotificationSettings.updateOne({ accountId, revision: input.revision }, { $set: { ...input, revision: input.revision + 1, effectiveFrom: new Date(Date.now()) } });
    return result.modifiedCount === 1;
}
export async function registerDevice(accountId: string, secret: string, platform: Platform, token: string, now = Date.now()) {
    // Possession of the unguessable installation secret permits account transfer on login.
    await NotificationDevice.findOneAndUpdate({ _id: hash(secret) }, { $set: {
        accountId, platform, sessionHash: hash(token), expiresAt: new Date(now + 30 * 86400_000),
    } }, { upsert: true });
}
export async function device(accountId: string, secret: string, token: string, now = Date.now()) {
    return NotificationDevice.findOne({ _id: hash(secret), accountId, sessionHash: hash(token), expiresAt: { $gt: new Date(now) } }).lean();
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
    const schedules = await Schedule.find({ accountId, date: { $gte: firstDate, $lte: lastDate },
        ...(cursorDate && cursorId ? { $or: [{ date: { $gt: cursorDate } }, { date: cursorDate, _id: { $gt: cursorId } }] } : {}),
    }).sort({ date: 1, _id: 1 }).limit(201).lean();
    const page = schedules.slice(0, 200);
    const last = page.at(-1);
    return { preferences: p, reminders: page.flatMap(s => remindersFor(s, p)).filter(r => r.dueAt >= now - GRACE_MS && r.dueAt <= now + HORIZON_MS), next: schedules.length > 200 && last ? `${last.date}:${last._id}` : null };
}

export async function claim(accountId: string, deviceId: string, platform: Platform, key: string, now = Date.now()) {
    const [scheduleId] = key.split(":");
    if (!scheduleId || !mongoose.isValidObjectId(scheduleId)) return null;
    const schedule = await Schedule.findOne({ _id: new mongoose.Types.ObjectId(scheduleId), accountId: new mongoose.Types.ObjectId(accountId) }).lean();
    if (!schedule) return null;
    const p = await preferences(accountId);
    if (!eligible(p, platform)) return null;
    const reminder = remindersFor(schedule, p).find(r => r.key === key && isDue(r, now));
    if (!reminder) return null;
    try {
        await NotificationDelivery.create({ _id: hash(`${accountId}:${deviceId}:${key}`), accountId, deviceId, scheduleId, claimedAt: new Date(now), expiresAt: new Date(reminder.eventAt + 90 * 86400_000) });
        // Fence edits/deletions and preference changes that raced the atomic claim.
        // A changed occurrence remains consumed rather than reviving an old reminder.
        const [current, latest] = await Promise.all([
            Schedule.exists({ _id: schedule._id, accountId: schedule.accountId, updatedAt: schedule.updatedAt }),
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
