import mongoose from "mongoose";
import { Account } from "../models/account.model.ts";
import { AuthTicket } from "../models/authTicket.model.ts";
import { OAuthState } from "../models/oauthState.model.ts";
import { tenantModels } from "./indexes.ts";
import { AiRequest, AiWindow } from "./aiUsage.ts";
import { withTenantWrite } from "./tenantWrite.ts";
import { measureStorage, storageUsage } from "./storage.ts";
import { PolicyError } from "./errors.ts";

export async function accountState(accountId: string) {
    // Reconciliation and reads share the same fence as writes and deletion.
    return withTenantWrite(accountId, async session => {
        const account = await Account.findById(accountId).session(session!);
        return { onboardingCompleted: account?.onboardingCompleted ?? false, cloudSyncEnabled: account?.cloudSyncEnabled === true, storage: storageUsage(await measureStorage(accountId, session!)) };
    });
}
export async function completeOnboarding(accountId: string) {
    await withTenantWrite(accountId, session => Account.updateOne({ _id: accountId }, { $set: { onboardingCompleted: true } }, { session: session! }));
}
export async function deleteAccount(accountId: string) {
    await mongoose.connection.transaction(async session => {
        const fence = await Account.updateOne({ _id: accountId, migratedTo: { $exists: false } }, { $inc: { guestWriteVersion: 1, sessionVersion: 1 } }, { session });
        if (!fence.matchedCount) throw new PolicyError(401, "SESSION_EXPIRED", "This account is no longer active.");
        const sources = await Account.find({ migratedTo: accountId }).select("_id").session(session);
        const ids = [new mongoose.Types.ObjectId(accountId), ...sources.map(row => row._id)];
        for (const model of [...tenantModels, AiRequest, AiWindow] as unknown as mongoose.Model<Record<string, unknown>>[]) {
            await model.deleteMany({ accountId: { $in: ids } }, { session });
        }
        await AuthTicket.deleteMany({ accountId: { $in: ids } }, { session });
        await OAuthState.deleteMany({ initiatorId: { $in: ids } }, { session });
        await Account.deleteMany({ _id: { $in: ids } }, { session });
    });
}
