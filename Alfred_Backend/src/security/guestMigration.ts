import mongoose from "mongoose";
import { AiRequest, AiWindow } from "./aiUsage.ts";
import { measureStorage } from "./storage.ts";
import { Account } from "../models/account.model.ts";
import { Task } from "../models/task.model.ts";
import { Note } from "../models/note.model.ts";
import { Schedule } from "../models/schedule.model.ts";
import { NotificationSettings, NotificationDevice, NotificationDelivery } from "../modules/schedule-notifications/models.ts";

/** Explicit system operation. Identity arguments come exclusively from the consumed
 * OAuth state and verified Google account. Transactions are mandatory: no unsafe
 * standalone fallback. Retry a failed login with the still-valid guest session. */
export async function migrateGuest(sourceId: mongoose.Types.ObjectId, targetId: mongoose.Types.ObjectId, version: number, finalize?: (session: mongoose.ClientSession) => Promise<void>): Promise<void> {
    if (sourceId.equals(targetId)) throw new Error("Invalid identity transition");
    await mongoose.connection.transaction(async session => {
        const target = await Account.findOne({ _id: targetId, type: "user" }).session(session);
        if (!target || !target.googleId || target.guestId) throw new Error("Invalid migration target");
        await Account.updateOne({ _id: targetId }, { $inc: { guestWriteVersion: 1 } }, { session });
        const source = await Account.findOne({ _id: sourceId, type: "guest" }).session(session);
        if (!source || !source.guestId || source.googleId) throw new Error("Invalid migration source");
        if (source.migratedTo) {
            if (source.migratedTo.equals(targetId)) { if (finalize) await finalize(session); return; }
            throw new Error("Guest session already migrated");
        }
        if ((source.sessionVersion ?? 0) !== version) throw new Error("Guest session revoked");
        // This write serializes concurrent transfers and forces stale transactions
        // to retry against the committed migration marker.
        const claimed = await Account.updateOne({ _id: sourceId, type: "guest", migratedTo: { $exists: false },  $or: [{ sessionVersion: version }, ...(version === 0 ? [{ sessionVersion: { $exists: false } }] : [])] }, {
            $set: { migratedTo: targetId }, $inc: { sessionVersion: 1 },
        }, { session });
        if (claimed.modifiedCount !== 1) throw new Error("Guest migration conflict");
        for (const model of [Task, Note, Schedule] as mongoose.Model<any>[]) {
            await model.updateMany({ accountId: sourceId, guestId: { $exists: false } }, { $set: { accountId: targetId } }, { session, timestamps: false });
        }
        const existingSettings = await NotificationSettings.exists({ accountId: targetId }).session(session);
        if (!existingSettings) await NotificationSettings.updateOne({ accountId: sourceId, guestId: { $exists: false } }, { $set: { accountId: targetId } }, { session });
        // On a preference collision preserve the old guest preferences as an
        // inaccessible archived record; never overwrite the existing user's choice.
        await NotificationDevice.updateMany({ accountId: sourceId, guestId: { $exists: false } }, { $set: { accountId: targetId, sessionHash: "revoked" } }, { session });
        await NotificationDelivery.updateMany({ accountId: sourceId, guestId: { $exists: false } }, { $set: { accountId: targetId, migrationSourceId: sourceId } }, { session });
        // Preserve data even if migration puts the target above its storage limit.
        // Windows merge instead of resetting either account's prior allowance.
        const windows = await AiWindow.find({ accountId: sourceId }).session(session);
        for (const row of windows) {
            await AiWindow.updateOne({ accountId: targetId, window: row.window, key: row.key }, { $inc: { used: row.used }, $setOnInsert: { expiresAt: row.expiresAt } }, { session, upsert: true });
        }
        await AiWindow.deleteMany({ accountId: sourceId }, { session });
        for (const request of await AiRequest.find({ accountId: sourceId }).session(session)) {
            const collision = await AiRequest.exists({ accountId: targetId, key: request.key }).session(session);
            await AiRequest.updateOne({ _id: request._id, accountId: sourceId }, { $set: { accountId: targetId, ...(collision ? { key: `migrated-${sourceId}-${request.key}` } : {}) } }, { session });
        }
        await Account.updateOne({ _id: targetId }, { $set: { storageBytes: await measureStorage(String(targetId), session), ...(source.onboardingCompleted ? { onboardingCompleted: true } : {}) } }, { session });
        if (finalize) await finalize(session);
    });
}
