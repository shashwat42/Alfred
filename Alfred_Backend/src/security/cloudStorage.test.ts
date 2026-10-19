import "./testEnvironment.ts";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Account } from "../models/account.model.ts";
import { Task } from "../models/task.model.ts";
import { Note } from "../models/note.model.ts";
import { tenantRepository } from "./tenantRepository.ts";
import { initializeSecurityIndexes } from "./indexes.ts";
import { cloudSnapshot, setCloudStorage, workspaceSchema } from "./cloudStorage.ts";
import { localWorkspaceContext } from "./localWorkspace.ts";
import { executeAiTool } from "../modules/ai/tools.ts";
import { emptyWorkspace, workspaceRequest } from "../workspace/data.ts";
import { policy } from "../config/policy.ts";
import { PolicyError, sendPolicyError } from "./errors.ts";
import tasksRouter from "../modules/tasks/route.ts";
import { generateAuthToken } from "../modules/auth/auth.service.ts";
import { findOrCreateGoogleAccount } from "../modules/auth/auth.service.ts";
import { generateChatCompletion } from "../modules/ai/service.ts";
import { env } from "../config/env.ts";
import { AiRequest } from "./aiUsage.ts";

let database: MongoMemoryReplSet;
let server: ReturnType<express.Express["listen"]>;
let base: string;
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: "127.0.0.1" } });
  await mongoose.connect(database.getUri()); await initializeSecurityIndexes();
  const app = express(); app.use(express.json()); app.use("/api/tasks", tasksRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => { if (!sendPolicyError(error, res)) next(error); });
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
}, { timeout: 180000 });
after(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); await database?.stop(); });
const user = () => Account.create({ type: "user", googleId: randomUUID() });
const code = (expected: string) => (error: unknown) => error instanceof PolicyError && error.details.code === expected;

test("new accounts default to device storage and old clients cannot persist cloud content", async () => {
  const account = await user(), id = String(account._id);
  assert.equal(account.cloudSyncEnabled, false);
  await assert.rejects(tenantRepository(Task, id).create({ task: "must stay local" }), code("CLOUD_SYNC_DISABLED"));
  const result = await fetch(`${base}/api/tasks`, { method: "POST", headers: { Authorization: `Bearer ${generateAuthToken(account)}`, "Content-Type": "application/json" }, body: JSON.stringify({ task: "old client write" }) });
  assert.equal(result.status, 409); assert.equal(await Task.countDocuments({ accountId: id }), 0);
});

test("new Google accounts persist identity without profile fields or cloud opt-in", async () => {
  const account = await findOrCreateGoogleAccount({ googleId: randomUUID(), email: "local-profile@example.test", name: "Local profile", picture: "https://example.test/avatar.png" });
  assert.equal(account.email, undefined); assert.equal(account.name, undefined); assert.equal(account.picture, undefined);
  assert.equal(account.cloudSyncEnabled, false);
});

test("enable uploads a validated snapshot; disable clears content only behind the downloaded revision", async () => {
  const account = await user(), id = String(account._id), other = await user();
  const data = emptyWorkspace(); workspaceRequest(data, new URL("https://local/api/tasks"), "POST", { task: "Saved locally" });
  assert.equal(workspaceSchema.safeParse(data).success, true);
  const initial = await cloudSnapshot(id);
  await setCloudStorage(id, true, initial.revision, data);
  assert.equal(await Task.countDocuments({ accountId: id }), 1);
  await assert.rejects(tenantRepository(Task, String(other._id)).create({ task: "other account" }), code("CLOUD_SYNC_DISABLED"));
  const downloaded = await cloudSnapshot(id);
  await tenantRepository(Task, id).create({ task: "concurrent device" });
  await assert.rejects(setCloudStorage(id, false, downloaded.revision), code("CLOUD_CHANGED"));
  assert.equal(await Task.countDocuments({ accountId: id }), 2);
  const fresh = await cloudSnapshot(id); assert.equal(fresh.data.tasks.length, 2);
  await setCloudStorage(id, false, fresh.revision);
  assert.equal(await Task.countDocuments({ accountId: id }), 0);
  assert.equal((await Account.findById(id))?.cloudSyncEnabled, false);
});

test("a cloud quota failure rolls back both the upload and opt-in", async () => {
  const account = await user(), id = String(account._id), data = emptyWorkspace();
  workspaceRequest(data, new URL("https://local/api/notes"), "POST", { content: "x".repeat(500) });
  const snapshot = await cloudSnapshot(id), before = { enforce: policy.enforceQuotas, bytes: policy.storageBytes };
  policy.enforceQuotas = true; policy.storageBytes = 100;
  try { await assert.rejects(setCloudStorage(id, true, snapshot.revision, data), code("STORAGE_QUOTA_EXCEEDED")); }
  finally { policy.enforceQuotas = before.enforce; policy.storageBytes = before.bytes; }
  assert.equal((await Account.findById(id))?.cloudSyncEnabled, false); assert.equal(await Note.countDocuments({ accountId: id }), 0);
});

test("local AI tools use request memory and cannot leak into Atlas or another account", async () => {
  const account = await user(), id = String(account._id), data = emptyWorkspace();
  await localWorkspaceContext.run({ accountId: id, data, requestId: randomUUID() }, async () => {
    const result = await executeAiTool("createTask", JSON.stringify({ task: "private local task" }), id);
    assert.equal(result.success, true); assert.equal(data.tasks[0]?.task, "private local task");
    assert.equal((await executeAiTool("createTask", JSON.stringify({ task: "private local task" }), id)).action?.id, result.action?.id);
    assert.equal((await tenantRepository(Task, id).find()).length, 1);
    assert.throws(() => tenantRepository(Task, String(new mongoose.Types.ObjectId())), code("ACCOUNT_MISMATCH"));
  });
  assert.equal(await Task.countDocuments({ accountId: id }), 0);
  assert.equal(workspaceSchema.safeParse({ ...data, tasks: [{ ...data.tasks[0], accountId: id }] }).success, false);
});

test("the full local AI tool loop returns a workspace and persists only request metadata", async () => {
  const account = await user(), id = String(account._id), previousFetch = globalThis.fetch, previousKey = env.llm.apiKey;
  const key = `local-ai-${randomUUID()}`;
  env.llm.apiKey = "isolated-stub-provider";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ model: "stub", choices: [{ message: calls === 1
      ? { role: "assistant", content: null, tool_calls: [{ id: "create-local-task", type: "function", function: { name: "createTask", arguments: JSON.stringify({ task: "Private device content" }) } }] }
      : { role: "assistant", content: "Created on your device." }, finish_reason: calls === 1 ? "tool_calls" : "stop" }] });
  };
  try {
    const result = await generateChatCompletion([{ role: "user", content: "Add a task" }], id, undefined, [], key, emptyWorkspace());
    assert.equal(result.localWorkspace?.tasks[0]?.task, "Private device content"); assert.equal(calls, 2);
    assert.equal(await Task.countDocuments({ accountId: id }), 0);
    const ledger = await AiRequest.findOne({ accountId: id, key }).lean();
    assert.equal(ledger?.status, "completed"); assert.doesNotMatch(JSON.stringify(ledger), /Private device content|localWorkspace/);
  } finally { globalThis.fetch = previousFetch; env.llm.apiKey = previousKey; }
});
