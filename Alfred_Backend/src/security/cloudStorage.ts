import mongoose from "mongoose";
import { workspaceSchema } from "../workspace/schema.ts";
export { workspaceSchema };
import { Account } from "../models/account.model.ts";
import { Task } from "../models/task.model.ts";
import { Note } from "../models/note.model.ts";
import { Schedule } from "../models/schedule.model.ts";
import { tenantModels } from "./indexes.ts";
import { withTenantWrite } from "./tenantWrite.ts";
import { PolicyError } from "./errors.ts";
import type { WorkspaceData } from "../workspace/data.ts";

const models = { tasks: Task, notes: Note, schedule: Schedule };
export async function cloudSnapshot(accountId: string) {
  return withTenantWrite(accountId, async session => {
    const account = await Account.findById(accountId).session(session!);
    const data: WorkspaceData = { tasks: [], notes: [], schedule: [] };
    for (const kind of ["tasks", "notes", "schedule"] as const) {
      const model = models[kind] as unknown as mongoose.Model<Record<string, unknown>>;
      const rows = await model.find({ accountId, guestId: { $exists: false } }).session(session!).lean();
      data[kind] = rows.map(row => { const copy = JSON.parse(JSON.stringify(row)); delete copy.accountId; delete copy.__v; return copy; });
    }
    return { data, enabled: account?.cloudSyncEnabled === true, revision: account?.guestWriteVersion ?? 0 };
  });
}
/** Explicit migration boundary: quota, account fence and all content commit together. */
export async function setCloudStorage(accountId: string, enabled: boolean, expectedRevision: number, data?: WorkspaceData) {
  return withTenantWrite(accountId, async session => {
    const account = await Account.findById(accountId).session(session!);
    // withTenantWrite has already advanced the fence by one.
    if (!account || account.guestWriteVersion !== expectedRevision + 1) throw new PolicyError(409, "CLOUD_CHANGED", "Cloud data changed on another device. Download the latest copy and retry.");
    if (enabled && !data) throw new PolicyError(400, "WORKSPACE_REQUIRED", "A device workspace is required to enable Cloud Sync.");
    if (enabled) {
      for (const kind of ["tasks", "notes", "schedule"] as const) {
        const model = models[kind] as unknown as mongoose.Model<Record<string, unknown>>;
        await model.deleteMany({ accountId, guestId: { $exists: false } }, { session: session! });
        for (const row of data![kind]) await model.create([{ ...row, accountId }], { session: session!, timestamps: false });
      }
    } else {
      for (const model of tenantModels as unknown as mongoose.Model<Record<string, unknown>>[]) await model.deleteMany({ accountId }, { session: session! });
    }
    await Account.updateOne({ _id: accountId }, { $set: { cloudSyncEnabled: enabled } }, { session: session! });
    return { enabled };
  });
}
