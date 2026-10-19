import mongoose, { type Model } from "mongoose";
import { withTenantWrite } from "./tenantWrite.ts";
import { memoryRepository } from "./localWorkspace.ts";

// The accountId argument is an internal execution context supplied by authentication,
// never a request field. Guests already have canonical Account IDs in Alfred.
export function ownership(accountId: string) {
    if (typeof accountId !== "string" || !/^[a-f\d]{24}$/i.test(accountId)) {
        throw new Error("A valid tenant execution context is required");
    }
    return { accountId: new mongoose.Types.ObjectId(accountId) };
}

export function assertSafeFields(value: unknown): void {
    if (!value || typeof value !== "object" || value instanceof Date || value instanceof mongoose.Types.ObjectId) return;
    for (const [key, child] of Object.entries(value)) {
        if (key.startsWith("$") || key.includes(".") || ["accountId", "guestId", "googleId", "googleSub", "userId", "__proto__", "constructor", "prototype"].includes(key)) {
            throw new Error("Reserved persistence field");
        }
        assertSafeFields(child);
    }
}

/** Deliberately narrow repository: no save, replacement, raw collection, arbitrary
 * update operators, joins, output stages or bulkWrite escape hatch. New persistence
 * methods must be implemented and reviewed here before use by a service. */
export function tenantRepository<T, TQueryHelpers, TMethods, TVirtuals>(sourceModel: Model<T, TQueryHelpers, TMethods, TVirtuals>, accountId: string) {
    // Normalize virtual/helper generics; raw document T remains unchanged.
    const model = sourceModel as unknown as Model<T>;
    const owner = ownership(accountId);
    const scope = (filter: Record<string, unknown> = {}) => {
        // Service-built filters only. Reject even a matching owner to prevent callers
        // from treating a filter as proof of authorization.
        if ("accountId" in filter || "guestId" in filter) throw new Error("Reserved ownership filter");
        return { ...filter, ...owner, guestId: { $exists: false } };
    };
    const update = (fields: Record<string, unknown>) => { assertSafeFields(fields); return { $set: fields }; };
    const repository = {
        find: async (filter = {}, options: { sort?: Record<string, 1 | -1>; limit?: number } = {}) =>
            await model.find(scope(filter)).sort(options.sort ?? {}).limit(options.limit ?? 0).lean(),
        findOne: async (filter = {}) => await model.findOne(scope(filter)).lean(),
        exists: async (filter = {}) => await model.exists(scope(filter)),
        countDocuments: async (filter = {}) => await model.countDocuments(scope(filter)),
        create: (fields: Record<string, unknown>) => {
            assertSafeFields(fields);
            const document = { ...fields, ...owner } as T;
            return withTenantWrite(accountId, async session => {
                if (!session) return await model.create(document);
                const doc = new model(document);
                return await doc.save({ session });
            }, true);
        },
        updateOne: (filter: Record<string, unknown>, fields: Record<string, unknown>) => {
            const changes = update(fields), scoped = scope(filter);
            return withTenantWrite(accountId, session => model.updateOne(scoped, changes, { runValidators: true, ...(session ? { session } : {}) }), true);
        },
        findOneAndUpdate: (filter: Record<string, unknown>, fields: Record<string, unknown>) => {
            const changes = update(fields), scoped = scope(filter);
            return withTenantWrite(accountId, session => model.findOneAndUpdate(scoped, changes, { returnDocument: "after", runValidators: true, ...(session ? { session } : {}) }).lean(), true);
        },
        deleteOne: (filter: Record<string, unknown>) => withTenantWrite(accountId, session => model.deleteOne(scope(filter), session ? { session } : {}), true),
        deleteMany: (filter = {}) => withTenantWrite(accountId, session => model.deleteMany(scope(filter), session ? { session } : {}), true),
        findOneAndDelete: (filter: Record<string, unknown>) => withTenantWrite(accountId, session => model.findOneAndDelete(scope(filter), session ? { session } : {}).lean(), true),
        // Only this fixed pipeline is permitted; atomic toggle cannot alter ownership.
        toggleCompleted: (id: mongoose.Types.ObjectId) => withTenantWrite(accountId, session => model.findOneAndUpdate(scope({ _id: id }), [{ $set: { completed: { $not: "$completed" } } }], { returnDocument: "after", updatePipeline: true, ...(session ? { session } : {}) }).lean(), true),
    };
    return (memoryRepository(model.modelName, accountId) ?? repository) as typeof repository;
}
