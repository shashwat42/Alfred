import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";
import { newRecordId, type WorkspaceData, type WorkspaceRecord } from "../workspace/data.ts";
import { PolicyError } from "./errors.ts";
import type { ToolExecutionResult } from "../modules/ai/tools.ts";

export interface WorkspaceContext { accountId: string; data: WorkspaceData; requestId: string; toolCache?: Map<string, { result: ToolExecutionResult; expiresAt: number }> }
export const localWorkspaceContext = new AsyncLocalStorage<WorkspaceContext>();
function matches(row: WorkspaceRecord, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return (value as Record<string, unknown>[]).some(part => matches(row, part));
    if (value instanceof RegExp) return value.test(String(row[key] ?? ""));
    if (value && typeof value === "object" && "$gt" in value) return String(row[key] ?? "") > String(value.$gt);
    return String(row[key]) === String(value);
  });
}
/** Request-only tool execution. Never connects to MongoDB or retains a workspace. */
export function memoryRepository(modelName: string, accountId: string) {
  const context = localWorkspaceContext.getStore();
  if (!context) return null;
  if (context.accountId !== accountId) throw new PolicyError(403, "ACCOUNT_MISMATCH", "Workspace account changed.");
  const kind = modelName === "Task" ? "tasks" : modelName === "Note" ? "notes" : modelName === "Schedule" ? "schedule" : null;
  if (!kind) throw new PolicyError(403, "LOCAL_WORKSPACE_ONLY", "This operation requires Cloud Sync.");
  const rows = () => context.data[kind];
  const find = async (filter: Record<string, unknown> = {}, options: { sort?: Record<string, 1 | -1>; limit?: number } = {}) => {
    const found = rows().filter(row => matches(row, filter));
    if (options.sort) found.sort((a, b) => { for (const [key, direction] of Object.entries(options.sort!)) { const comparison = String(a[key] ?? "").localeCompare(String(b[key] ?? "")); if (comparison) return comparison * direction; } return 0; });
    return structuredClone(options.limit ? found.slice(0, options.limit) : found);
  };
  const change = async (filter: Record<string, unknown>, fields: Record<string, unknown>) => {
    const index = rows().findIndex(row => matches(row, filter));
    if (index < 0) return null;
    const now = new Date().toISOString();
    const row = { ...rows()[index]!, ...fields, updatedAt: now } as WorkspaceRecord;
    // Use the Mongoose model's validation/defaults without saving anything.
    const validated = new (mongoose.model(modelName))({ ...row, accountId });
    await validated.validate();
    rows()[index] = JSON.parse(JSON.stringify(validated.toObject())) as WorkspaceRecord;
    delete rows()[index]!.accountId;
    return structuredClone(rows()[index]);
  };
  const remove = async (filter: Record<string, unknown> = {}) => { const matched = rows().filter(row => matches(row, filter)); context.data[kind] = rows().filter(row => !matches(row, filter)); return matched; };
  return {
    find,
    findOne: async (filter = {}) => (await find(filter))[0] ?? null,
    exists: async (filter = {}) => Boolean((await find(filter)).length),
    countDocuments: async (filter = {}) => (await find(filter)).length,
    create: async (fields: Record<string, unknown>) => {
      const now = new Date().toISOString();
      const doc = new (mongoose.model(modelName))({ ...fields, _id: newRecordId(), accountId, createdAt: now, updatedAt: now });
      await doc.validate();
      const row = JSON.parse(JSON.stringify(doc.toObject())) as WorkspaceRecord; delete row.accountId;
      rows().push(row);
      return doc;
    },
    findOneAndUpdate: change,
    updateOne: async (filter: Record<string, unknown>, fields: Record<string, unknown>) => ({ matchedCount: await change(filter, fields) ? 1 : 0 }),
    deleteMany: async (filter = {}) => ({ deletedCount: (await remove(filter)).length }),
    deleteOne: async (filter: Record<string, unknown>) => { const row = (await find(filter))[0]; return { deletedCount: row ? (await remove({ _id: row._id })).length : 0 }; },
    findOneAndDelete: async (filter: Record<string, unknown>) => { const row = (await find(filter))[0]; if (row) await remove({ _id: row._id }); return row ?? null; },
    toggleCompleted: async (id: mongoose.Types.ObjectId) => { const row = (await find({ _id: id }))[0]; return row ? change({ _id: id }, { completed: !row.completed }) : null; },
  };
}
