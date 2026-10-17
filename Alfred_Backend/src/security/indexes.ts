import { Account } from "../models/account.model.ts";
import { OAuthState } from "../models/oauthState.model.ts";
import { AuthTicket } from "../models/authTicket.model.ts";
import { Task } from "../models/task.model.ts";
import { Note } from "../models/note.model.ts";
import { Schedule } from "../models/schedule.model.ts";
import { NotificationSettings, NotificationDevice, NotificationDelivery } from "../modules/schedule-notifications/models.ts";
import mongoose from "mongoose";

export const tenantModels = [Task, Note, Schedule, NotificationSettings, NotificationDevice, NotificationDelivery];

export async function requireTransactionTopology() {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid") {
        throw new Error("MongoDB replica set or mongos is required for guest persistence and migration");
    }
}

// Explicit deployment/startup system operation, never a tenant API. Additive only:
// do not syncIndexes() or drop indexes that may be required by older deployments.
export async function initializeSecurityIndexes() {
    for (const model of [Account, OAuthState, AuthTicket, ...tenantModels]) {
        await model.createIndexes();
    }
}

export async function auditTenantDatabase() {
    const report = [];
    for (const model of tenantModels) {
        const collection = model.collection;
        // Read-only aggregate is intentionally global and returns counts, not data.
        const orphaned = await collection.aggregate([
            { $lookup: { from: Account.collection.name, localField: "accountId", foreignField: "_id", as: "owner" } },
            { $match: { "owner.0": { $exists: false } } }, { $count: "count" },
        ]).toArray();
        report.push({ collection: collection.name,
            malformedOwner: await collection.countDocuments({ accountId: { $not: { $type: "objectId" } } }),
            conflictingGuestField: await collection.countDocuments({ guestId: { $exists: true } }),
            orphanedOwner: orphaned[0]?.count ?? 0,
            indexes: await collection.indexes(),
        });
    }
    return report;
}
