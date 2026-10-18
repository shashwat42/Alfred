import mongoose from "mongoose";
import { Account } from "../models/account.model.ts";
import { measureStorage, enforceStorage } from "./storage.ts";

/** All account mutations, migration, quota admission and deletion share an Account
 * write fence. MongoDB retries conflicts against a fresh snapshot; the content
 * mutation and measured BSON usage commit or roll back together. */
export async function withTenantWrite<T>(accountId: string, write: (session?: mongoose.ClientSession) => PromiseLike<T>): Promise<T> {
    if (typeof accountId !== "string" || !/^[a-f\d]{24}$/i.test(accountId)) throw new Error("Invalid tenant context");
    return mongoose.connection.transaction(async session => {
        const fence = await Account.updateOne({ _id: accountId, migratedTo: { $exists: false } }, {
            $inc: { guestWriteVersion: 1 },
        }, { session });
        if (fence.matchedCount !== 1) throw new Error("Tenant is no longer active");
        const before = await measureStorage(accountId, session);
        const result = await write(session);
        const after = await measureStorage(accountId, session);
        enforceStorage(before, after);
        await Account.updateOne({ _id: accountId }, { $set: { storageBytes: after } }, { session, timestamps: false });
        return result;
    });
}
