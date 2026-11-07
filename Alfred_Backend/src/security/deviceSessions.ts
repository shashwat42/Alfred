import { createHash } from "node:crypto";
import { Account, type IAccount } from "../models/account.model.ts";

export function activeRevocations(account: Pick<IAccount, "revokedDeviceSessions">, now = Date.now()): string[] {
    return (account.revokedDeviceSessions ?? []).filter(entry => entry.expiresAt.getTime() > now).map(entry => entry.hash);
}

export function sessionWasRevoked(account: Pick<IAccount, "revokedDeviceSessions">, token: string): boolean {
    return Boolean(account.revokedDeviceSessions?.length)
        && activeRevocations(account).includes(createHash("sha256").update(token).digest("hex"));
}

export async function revokeDeviceSession(account: IAccount, hash: string, sessionExpiresAt: Date): Promise<boolean> {
    const version = account.sessionVersion ?? 0;
    // Guest tokens can be renewed for 30 days after expiry.
    const expiresAt = new Date(sessionExpiresAt.getTime() + (account.type === "guest" ? 30 * 86400_000 : 0));
    const result = await Account.updateOne({
        _id: account._id, cloudSyncEnabled: true, migratedTo: { $exists: false },
        ...(version === 0 ? { $or: [{ sessionVersion: 0 }, { sessionVersion: { $exists: false } }] } : { sessionVersion: version }),
    }, [{ $set: { revokedDeviceSessions: { $concatArrays: [
        { $filter: { input: { $ifNull: ["$revokedDeviceSessions", []] }, as: "entry",
            cond: { $and: [{ $gt: ["$$entry.expiresAt", new Date()] }, { $ne: ["$$entry.hash", hash] }] } } },
        [{ hash, expiresAt }],
    ] } } }], { updatePipeline: true });
    return result.matchedCount === 1;
}
