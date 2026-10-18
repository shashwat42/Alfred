import mongoose, { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import { Account } from "../models/account.model.ts";
import { policy, utcWindows } from "../config/policy.ts";
import { PolicyError } from "./errors.ts";

const windowSchema = new Schema({
    accountId: { type: Schema.Types.ObjectId, required: true },
    window: { type: String, required: true }, key: { type: String, required: true },
    used: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true, expires: 0 },
});
windowSchema.index({ accountId: 1, window: 1, key: 1 }, { unique: true });
export const AiWindow = mongoose.model("AiUsageWindow", windowSchema);
const requestSchema = new Schema({
    accountId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true }, fingerprint: { type: String, required: true },
    status: { type: String, enum: ["dispatched", "completed", "failed", "interrupted"], required: true },
    createdAt: { type: Date, required: true }, expiresAt: { type: Date, required: true, expires: 0 },
});
requestSchema.index({ accountId: 1, key: 1 }, { unique: true });
export const AiRequest = mongoose.model("AiLogicalRequest", requestSchema);

export async function aiUsage(accountId: string, now = new Date()) {
    const windows = utcWindows(now);
    const result = {} as Record<"daily" | "monthly", { used: number; limit: number | null; remaining: number | null; resetAt: string }>;
    for (const window of ["daily", "monthly"] as const) {
        const doc = await AiWindow.findOne({ accountId, window, key: windows[window].key }).lean();
        const used = doc?.used ?? 0, limit = window === "daily" ? policy.dailyRequests : policy.monthlyRequests;
        result[window] = { used, limit: policy.enforceQuotas ? limit : null, remaining: policy.enforceQuotas ? Math.max(0, limit - used) : null, resetAt: windows[window].resetAt };
    }
    return result;
}

/** One durable admission per logical interaction. All upstream fallbacks/tool loops
 * execute inside run(), so cannot charge again. Dispatched failures remain charged:
 * a timeout/disconnect does not establish that the provider did no work. */
export async function withAiRequest<T>(accountId: string, key: string | undefined, fingerprint: string, run: () => Promise<T>): Promise<T> {
    const requestKey = key ?? randomUUID();
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey)) throw new PolicyError(400, "INVALID_REQUEST_KEY", "Invalid AI request identifier.");
    await mongoose.connection.transaction(async session => {
        const fence = await Account.updateOne({ _id: accountId, migratedTo: { $exists: false } }, { $inc: { guestWriteVersion: 1 } }, { session });
        if (fence.matchedCount !== 1) throw new PolicyError(401, "SESSION_EXPIRED", "Your session is no longer active.");
        const existing = await AiRequest.findOne({ accountId, key: requestKey }).session(session);
        if (existing) throw new PolicyError(409, existing.fingerprint === fingerprint ? "AI_REQUEST_ALREADY_ACCEPTED" : "REQUEST_KEY_CONFLICT", "This request was already accepted. Refresh your data before sending a new request.", { requestStatus: existing.status });
        const now = new Date(), windows = utcWindows(now);
        for (const window of ["daily", "monthly"] as const) {
            const scope = { accountId, window, key: windows[window].key };
            const current = await AiWindow.findOne(scope).session(session);
            const used = current?.used ?? 0, limit = window === "daily" ? policy.dailyRequests : policy.monthlyRequests;
            if (policy.enforceQuotas && used >= limit) throw new PolicyError(429, "AI_QUOTA_EXCEEDED", `Your ${window} AI allowance is exhausted. It resets at ${windows[window].resetAt}.`, { window, limit, used, remaining: 0, resetAt: windows[window].resetAt });
            await AiWindow.updateOne(scope, { $inc: { used: 1 }, $setOnInsert: { expiresAt: new Date(Date.parse(windows[window].resetAt) + 40 * 86400_000) } }, { upsert: true, session });
        }
        await AiRequest.create([{ accountId, key: requestKey, fingerprint, status: "dispatched", createdAt: now, expiresAt: new Date(now.getTime() + 40 * 86400_000) }], { session });
    });
    try {
        const result = await run();
        // Completion status is diagnostic: a ledger outage must not discard an
        // already successful response or its confirmed action synchronization.
        await AiRequest.updateOne({ accountId, key: requestKey }, { $set: { status: "completed" } }).catch(() => {});
        return result;
    } catch (error) {
        await AiRequest.updateOne({ accountId, key: requestKey }, { $set: { status: "failed" } }).catch(() => {});
        throw error;
    }
}

// Conservative recovery: never replay or refund work whose upstream outcome is unknown.
export async function reconcileAiRequests() {
    await AiRequest.updateMany({ status: "dispatched", createdAt: { $lt: new Date(Date.now() - 3600_000) } }, { $set: { status: "interrupted" } });
}
