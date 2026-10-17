import mongoose from "mongoose";
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
        if (finalize) await finalize(session);
    });
}
