import mongoose from "mongoose";
import { Task } from "../models/task.model.ts";
import { Note } from "../models/note.model.ts";
import { Schedule } from "../models/schedule.model.ts";
import { NotificationSettings } from "../modules/schedule-notifications/models.ts";
import { policy } from "../config/policy.ts";
import { PolicyError } from "./errors.ts";

// Full serialized BSON documents, including ownership, IDs and timestamps. Operational
// identities, leases, delivery claims and quota ledgers are excluded (see reliability.md).
export const storageModels = [Task, Note, Schedule, NotificationSettings];
export async function measureStorage(accountId: string, session: mongoose.ClientSession): Promise<number> {
    let bytes = 0;
    for (const model of storageModels as unknown as mongoose.Model<Record<string, unknown>>[]) {
        const rows = await model.aggregate<{ bytes: number }>([
            { $match: { accountId: new mongoose.Types.ObjectId(accountId), guestId: { $exists: false } } },
            { $group: { _id: null, bytes: { $sum: { $bsonSize: "$$ROOT" } } } },
        ]).session(session);
        bytes += rows[0]?.bytes ?? 0;
    }
    return bytes;
}
export function enforceStorage(before: number, after: number) {
    if (policy.enforceQuotas && after > policy.storageBytes && after > before) throw new PolicyError(413, "STORAGE_QUOTA_EXCEEDED", "Cloud storage is full. Delete cloud content or keep data on your device.", { usedBytes: before, limitBytes: policy.storageBytes, requestedBytes: after - before });
}
export function storageUsage(usedBytes: number) {
    return { usedBytes, limitBytes: policy.enforceQuotas ? policy.storageBytes : null, remainingBytes: policy.enforceQuotas ? Math.max(0, policy.storageBytes - usedBytes) : null, overQuota: policy.enforceQuotas && usedBytes > policy.storageBytes };
}
