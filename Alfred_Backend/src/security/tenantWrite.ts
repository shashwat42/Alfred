import mongoose from "mongoose";
import { Account } from "../models/account.model.ts";

/** Guest mutations and migration share an Account write fence. An in-flight guest
 * request cannot insert stranded data after its migration has committed, even on
 * another server instance. Authenticated writes keep their normal atomic operation. */
export async function withTenantWrite<T>(accountId: string, write: (session?: mongoose.ClientSession) => PromiseLike<T>): Promise<T> {
    if (typeof accountId !== "string" || !/^[a-f\d]{24}$/i.test(accountId)) throw new Error("Invalid tenant context");
    const account = await Account.findById(accountId);
    if (!account || account.migratedTo) throw new Error("Tenant is no longer active");
    if (account.type === "user") return await write();
    return mongoose.connection.transaction(async session => {
        const fence = await Account.updateOne({ _id: account._id, type: "guest", migratedTo: { $exists: false } }, {
            $inc: { guestWriteVersion: 1 },
        }, { session });
        if (fence.matchedCount !== 1) throw new Error("Guest session is no longer active");
        return await write(session);
    });
}
