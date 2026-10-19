import "./testEnvironment.ts";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import express from "express";
import { policy, parseMode, utcWindows } from "../config/policy.ts";
import { Account } from "../models/account.model.ts";
import { Task } from "../models/task.model.ts";
import { Note } from "../models/note.model.ts";
import { AuthTicket } from "../models/authTicket.model.ts";
import { OAuthState } from "../models/oauthState.model.ts";
import { tenantRepository } from "./tenantRepository.ts";
import { initializeSecurityIndexes, tenantModels } from "./indexes.ts";
import { AiRequest, AiWindow, aiUsage, withAiRequest, reconcileAiRequests } from "./aiUsage.ts";
import { accountState, completeOnboarding, deleteAccount } from "./accountLifecycle.ts";
import { sendPolicyError, PolicyError } from "./errors.ts";
import { migrateGuest } from "./guestMigration.ts";
import { generateAuthToken } from "../modules/auth/auth.service.ts";
import accountRouter from "../modules/auth/account.routes.ts";
import authRouter from "../modules/auth/auth.routes.ts";
import { executeAiTool } from "../modules/ai/tools.ts";
import { generateChatCompletion } from "../modules/ai/service.ts";
import { env, parseAllowedOrigins } from "../config/env.ts";

let database: MongoMemoryReplSet;
let server: ReturnType<express.Express["listen"]>;
let base = "";
before(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri("alfred_reliability_test"));
    await initializeSecurityIndexes();
    const app = express(); app.use(express.json()); app.use("/account", accountRouter); app.use("/auth", authRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => { if (res.headersSent) { next(error); return; } if (!sendPolicyError(error, res)) res.status(503).json({ error: "Unavailable" }); });
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
}, { timeout: 180_000 });
after(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); await database?.stop(); });
const user = () => Account.create({ cloudSyncEnabled: true, type: "user", googleId: randomUUID() });
const request = (token?: string, method = "GET", body?: unknown) => fetch(`${base}/account`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const rejectCode = (code: string) => (error: unknown) => error instanceof PolicyError && error.details.code === code;

// Exercise quota guards as fixtures without starting a production-mode server.
function testWithQuotas(name: string, run: () => Promise<void>) {
    test(name, async () => {
        const previous = policy.enforceQuotas; policy.enforceQuotas = true;
        try { await run(); } finally { policy.enforceQuotas = previous; }
    });
}

test("development allows over-quota storage and AI usage while preserving ownership and request deduplication", async () => {
    assert.equal(env.mode, "development"); assert.equal(policy.enforceQuotas, false);
    const account = await user(), id = String(account._id), windows = utcWindows();
    const oldStorage = policy.storageBytes; policy.storageBytes = 100;
    try {
        await tenantRepository(Note, id).create({ content: "x".repeat(500) });
        for (const window of ["daily", "monthly"] as const) await AiWindow.create({ accountId: id, window, key: windows[window].key, used: 2000, expiresAt: new Date(Date.now() + 86400_000) });
        let calls = 0;
        await withAiRequest(id, "development-request", "f", async () => ++calls);
        await assert.rejects(withAiRequest(id, "development-request", "f", async () => ++calls), rejectCode("AI_REQUEST_ALREADY_ACCEPTED"));
        assert.equal(calls, 1);
        const state = await accountState(id), usage = await aiUsage(id);
        assert.ok(state.storage.usedBytes > 100); assert.equal(state.storage.limitBytes, null); assert.equal(state.storage.remainingBytes, null); assert.equal(state.storage.overQuota, false);
        assert.equal(usage.daily.used, 2001); assert.equal(usage.daily.limit, null); assert.equal(usage.daily.remaining, null); assert.equal(usage.monthly.limit, null);
    } finally { policy.storageBytes = oldStorage; }
});

test("mode validation fails closed and UTC windows cover leap day and year rollover", () => {
    assert.equal(parseMode(undefined), "production"); assert.equal(parseMode(undefined, "development"), "development");
    assert.equal(parseMode("production", "development"), "production");
    for (const mode of ["", "test", "Development", "development "]) assert.throws(() => parseMode(mode), /MODE/);
    assert.equal(policy.storageBytes, 10_000_000); assert.equal(policy.dailyRequests, 50); assert.equal(policy.monthlyRequests, 1000);
    assert.equal(utcWindows(new Date("2028-02-29T23:59:59Z")).daily.resetAt, "2028-03-01T00:00:00.000Z");
    assert.equal(utcWindows(new Date("2026-12-31T23:59:59Z")).monthly.resetAt, "2027-01-01T00:00:00.000Z");
});
test("production keeps exact packaged application origins without allowing arbitrary sites", () => {
    for (const configured of [undefined, "https://alfred.example"]) {
        const origins = parseAllowedOrigins(configured, "https://alfred.example", true);
        assert.ok(origins.includes("http://tauri.localhost")); assert.ok(origins.includes("https://tauri.localhost"));
        assert.ok(origins.includes("https://alfred.example")); assert.ok(!origins.includes("*"));
        assert.ok(!origins.includes("https://unrelated.example")); assert.ok(!origins.includes("http://localhost:5173"));
    }
});
test("development backend cold-starts and serves a native guest account with CORS", { timeout: 60_000 }, async () => {
    const portProbe = createTcpServer(); portProbe.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => portProbe.once("listening", resolve));
    const address = portProbe.address(); assert.ok(address && typeof address !== "string");
    const port = address.port; await new Promise<void>(resolve => portProbe.close(() => resolve()));
    const child = spawn(process.execPath, ["server.ts"], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: { ...process.env, MODE: "development", PORT: String(port), MONGODB_URI: database.getUri("alfred_development_start_test"),
            JWT_SECRET: "isolated-development-start-secret-at-least-32-characters", FRONTEND_URL: "https://alfred.example", ALLOWED_ORIGINS: "", LLM_API_KEY: "" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Development startup timed out")), 30_000);
            child.once("error", error => { clearTimeout(timer); reject(error); });
            child.once("exit", code => { clearTimeout(timer); reject(new Error(`Development server exited before startup (${code})`)); });
            child.stdout.on("data", data => { if (String(data).includes("Server listening")) { clearTimeout(timer); resolve(); } });
        });
        const url = `http://127.0.0.1:${port}`;
        assert.equal((await (await fetch(`${url}/health`)).json() as { mode: string }).mode, "development");
        const origin = "http://tauri.localhost";
        const preflight = await fetch(`${url}/auth/guest`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
        assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
        const guestResponse = await fetch(`${url}/auth/guest`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
        assert.equal(guestResponse.status, 201); assert.equal(guestResponse.headers.get("access-control-allow-origin"), origin);
        const guest = await guestResponse.json() as { token: string; account: { type: string } };
        assert.equal(guest.account.type, "guest");
        assert.equal((await fetch(`${url}/api/account`, { headers: { Origin: origin, Authorization: `Bearer ${guest.token}` } })).status, 200);
    } finally {
        child.kill(); await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
    }
});
test("BSON storage tracks creates, increases, decreases and deletions; reconciliation repairs drift", async () => {
    const account = await user(), id = String(account._id), repo = tenantRepository(Note, id);
    const note = await repo.create({ title: "A note", content: "hello" });
    const initial = (await accountState(id)).storage.usedBytes;
    assert.equal(initial, mongoose.mongo.BSON.calculateObjectSize(note.toObject()));
    await repo.updateOne({ _id: note._id }, { content: "x".repeat(1000) });
    assert.equal((await accountState(id)).storage.usedBytes, initial + 995);
    await repo.updateOne({ _id: note._id }, { content: "a" });
    assert.equal((await accountState(id)).storage.usedBytes, initial - 4);
    await Account.updateOne({ _id: id }, { $set: { storageBytes: 999999 } });
    assert.equal((await accountState(id)).storage.usedBytes, initial - 4);
    await repo.deleteOne({ _id: note._id }); assert.equal((await accountState(id)).storage.usedBytes, 0);
});
testWithQuotas("over-limit writes roll back; concurrent storage writes cannot exceed the limit", async () => {
    const original = policy.storageBytes; policy.storageBytes = 700;
    try {
        const account = await user(), repo = tenantRepository(Note, String(account._id));
        const results = await Promise.allSettled([repo.create({ content: "a".repeat(350) }), repo.create({ content: "b".repeat(350) })]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        const rejected = results.find(result => result.status === "rejected"); assert.ok(rejected?.status === "rejected" && rejectCode("STORAGE_QUOTA_EXCEEDED")(rejected.reason));
        assert.equal(await Note.countDocuments({ accountId: account._id }), 1);
        assert.ok((await accountState(String(account._id))).storage.usedBytes <= 700);
    } finally { policy.storageBytes = original; }
});
testWithQuotas("existing over-quota data survives and permits shrinking and deletion", async () => {
    const original = policy.storageBytes; policy.storageBytes = 500;
    try {
        const account = await user(), id = String(account._id), repo = tenantRepository(Note, id);
        const legacy = await Note.create({ accountId: account._id, content: "x".repeat(2000) });
        assert.equal((await accountState(id)).storage.overQuota, true);
        await assert.rejects(repo.updateOne({ _id: legacy._id }, { content: "x".repeat(2100) }), rejectCode("STORAGE_QUOTA_EXCEEDED"));
        assert.equal((await Note.findById(legacy._id))!.content.length, 2000);
        await repo.updateOne({ _id: legacy._id }, { content: "x".repeat(1000) });
        assert.equal((await accountState(id)).storage.overQuota, true);
        await repo.deleteOne({ _id: legacy._id }); assert.equal((await accountState(id)).storage.usedBytes, 0);
    } finally { policy.storageBytes = original; }
});
testWithQuotas("AI tools use the same storage guard and cannot update another account", async () => {
    const original = policy.storageBytes; policy.storageBytes = 200;
    try {
        const a = await user(), b = await user();
        const result = await executeAiTool("createTask", JSON.stringify({ task: "x".repeat(1000) }), String(a._id));
        assert.equal(result.success, false); assert.match(result.error!, /STORAGE_QUOTA_EXCEEDED/);
        assert.equal(await Task.countDocuments({ accountId: a._id }), 0);
        const foreign = await Note.create({ accountId: b._id, content: "private" });
        await tenantRepository(Note, String(a._id)).updateOne({ _id: foreign._id }, { content: "hijacked" });
        assert.equal((await Note.findById(foreign._id))!.content, "private");
        assert.equal((await accountState(String(a._id))).storage.usedBytes, 0);
    } finally { policy.storageBytes = original; }
});
testWithQuotas("logical requests 1–50 succeed; 51 is rejected before provider dispatch", async () => {
    const a = await user(), id = String(a._id); let calls = 0;
    for (let index = 0; index < 50; index++) await withAiRequest(id, `request-${index}`, "fingerprint", async () => ++calls);
    await assert.rejects(withAiRequest(id, "request-51", "fingerprint", async () => ++calls), error => rejectCode("AI_QUOTA_EXCEEDED")(error) && (error as PolicyError).details.window === "daily");
    assert.equal(calls, 50); assert.equal((await aiUsage(id)).daily.used, 50); assert.equal((await aiUsage(id)).monthly.used, 50);
});
testWithQuotas("monthly allowance is independent; the 1,001st request cannot dispatch", async () => {
    const a = await user(), id = String(a._id), windows = utcWindows(); let calls = 0;
    await AiWindow.create({ accountId: a._id, window: "monthly", key: windows.monthly.key, used: 999, expiresAt: new Date(Date.now() + 86400_000) });
    await withAiRequest(id, "monthly-1000", "f", async () => ++calls);
    await assert.rejects(withAiRequest(id, "monthly-1001", "f", async () => ++calls), error => rejectCode("AI_QUOTA_EXCEEDED")(error) && (error as PolicyError).details.window === "monthly");
    assert.equal(calls, 1); assert.equal((await aiUsage(id)).daily.used, 1);
});
testWithQuotas("concurrent AI admission and duplicate IDs serialize across instances", async () => {
    const a = await user(), id = String(a._id); let calls = 0;
    const original = policy.dailyRequests; policy.dailyRequests = 3;
    try {
        const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => withAiRequest(id, `concurrent-${index}`, "f", async () => ++calls)));
        assert.equal(results.filter(row => row.status === "fulfilled").length, 3); assert.equal(calls, 3);
        assert.equal((await aiUsage(id)).daily.used, 3);
    } finally { policy.dailyRequests = original; }
    const b = await user();
    const duplicates = await Promise.allSettled(Array.from({ length: 6 }, () => withAiRequest(String(b._id), "same-request-id", "f", async () => ++calls)));
    assert.equal(duplicates.filter(row => row.status === "fulfilled").length, 1); assert.equal((await aiUsage(String(b._id))).daily.used, 1);
});
test("provider failures remain charged, retries do not reexecute, interrupted reservations reconcile", async () => {
    const a = await user(), id = String(a._id); let calls = 0;
    await assert.rejects(withAiRequest(id, "failed-request", "f", async () => { calls++; throw new Error("provider timeout"); }), /provider timeout/);
    await assert.rejects(withAiRequest(id, "failed-request", "f", async () => ++calls), rejectCode("AI_REQUEST_ALREADY_ACCEPTED"));
    assert.equal(calls, 1); assert.equal((await aiUsage(id)).daily.used, 1);
    await AiRequest.updateOne({ accountId: id, key: "failed-request" }, { $set: { status: "dispatched", createdAt: new Date(Date.now() - 7200_000) } });
    await reconcileAiRequests(); assert.equal((await AiRequest.findOne({ accountId: id }))!.status, "interrupted");
    assert.equal((await aiUsage(id)).daily.used, 1);
});
test("chat, voice, internal model calls and tools share a single logical request budget", async () => {
    const a = await user(), id = String(a._id), saved = globalThis.fetch, key = env.llm.apiKey; let calls = 0;
    env.llm.apiKey = "isolated-test-provider";
    globalThis.fetch = async () => {
        calls++;
        return Response.json({ choices: [{ message: calls === 1 ? { content: null, tool_calls: [{ id: "call", function: { name: "createTask", arguments: JSON.stringify({ task: `AI test ${randomUUID()}` }) } }] } : { content: "Done" }, finish_reason: "stop" }] });
    };
    try {
        await generateChatCompletion([{ role: "user", content: "Create a task" }], id, undefined, [], "chat-interaction");
        await generateChatCompletion([{ role: "user", content: "Voice message" }], id, { data: "fixture-audio", format: "wav" }, [], "voice-interaction");
        assert.equal(calls, 3); assert.equal((await aiUsage(id)).daily.used, 2); assert.equal(await Task.countDocuments({ accountId: id }), 1);
        await assert.rejects(generateChatCompletion([{ role: "user", content: "Create a task" }], id, undefined, [], "chat-interaction"), rejectCode("AI_REQUEST_ALREADY_ACCEPTED"));
        assert.equal(calls, 3);
    } finally { globalThis.fetch = saved; env.llm.apiKey = key; }
});
test("account switching does not mix storage or AI allowances; old UTC windows do not carry over", async () => {
    const a = await user(), b = await user();
    await withAiRequest(String(a._id), "scoped-request", "f", async () => true);
    assert.equal((await aiUsage(String(b._id))).daily.used, 0);
    assert.equal((await aiUsage(String(a._id), new Date("2030-01-01T00:00:00Z"))).daily.used, 0);
    assert.equal((await aiUsage(String(a._id), new Date("2030-01-01T00:00:00Z"))).monthly.used, 0);
});
test("onboarding and AI usage transfer during guest migration without bypassing limits", async () => {
    const guest = await Account.create({ cloudSyncEnabled: true, type: "guest", guestId: randomUUID() }), target = await user();
    await completeOnboarding(String(guest._id));
    await withAiRequest(String(guest._id), "guest-interaction", "f", async () => true);
    await withAiRequest(String(target._id), "user-interaction", "f", async () => true);
    await withAiRequest(String(guest._id), "colliding-request", "f", async () => true);
    await withAiRequest(String(target._id), "colliding-request", "f", async () => true);
    await migrateGuest(guest._id, target._id, 0);
    assert.equal((await accountState(String(target._id))).onboardingCompleted, true);
    assert.equal((await aiUsage(String(target._id))).daily.used, 4);
    assert.equal(await AiRequest.countDocuments({ accountId: target._id }), 4);
    await assert.rejects(withAiRequest(String(guest._id), "after-migration", "f", async () => true), rejectCode("SESSION_EXPIRED"));
});
test("account API requires ownership, explicit deletion confirmation and recent sign-in", async () => {
    const a = await user(), b = await user(), token = generateAuthToken(a);
    assert.equal((await request()).status, 401);
    assert.equal((await fetch(`${base}/account?simulate=signed-in&MODE=development`, { headers: { "X-Simulation": "true" } })).status, 401);
    assert.equal((await request(token, "DELETE", { confirmation: "DELETE", accountId: String(b._id) })).status, 400);
    assert.equal((await request(token, "DELETE", { confirmation: "delete" })).status, 400);
    const { default: jwt } = await import("jsonwebtoken");
    const old = jwt.sign({ sub: String(a._id), type: "user", version: 0, iat: Math.floor(Date.now() / 1000) - 3600 }, env.jwt.secret, { expiresIn: "1d", issuer: "alfred", audience: "alfred-api" });
    assert.equal((await request(old, "DELETE", { confirmation: "DELETE" })).status, 403);
    assert.equal((await request(token, "DELETE", { confirmation: "DELETE" })).status, 204);
    assert.equal((await request(token, "DELETE", { confirmation: "DELETE" })).status, 401);
    assert.ok(await Account.exists({ _id: b._id }));
});
test("database authentication lookup failures are service errors, not expired sessions", async t => {
    const a = await user(), token = generateAuthToken(a);
    t.mock.method(Account, "findById", async () => { throw new Error("isolated database failure"); });
    assert.equal((await request(token)).status, 503);
    assert.equal((await request("tampered-token")).status, 401);
});
test("deletion cleans all owned records and migrated archives without touching other accounts", async () => {
    const a = await user(), b = await user(), guest = await Account.create({ cloudSyncEnabled: true, type: "guest", guestId: randomUUID(), migratedTo: a._id });
    await tenantRepository(Note, String(a._id)).create({ content: "private" });
    await tenantRepository(Note, String(b._id)).create({ content: "keep" });
    await withAiRequest(String(a._id), "to-be-deleted", "f", async () => true);
    await AuthTicket.create({ accountId: a._id, ticket: randomUUID(), flow: "browser", expiresAt: new Date(Date.now() + 60000) });
    await OAuthState.create({ initiatorId: a._id, initiatorVersion: 0, state: randomUUID(), nonce: randomUUID(), flow: "browser", expiresAt: new Date(Date.now() + 60000) });
    await deleteAccount(String(a._id));
    for (const model of [...tenantModels, AiRequest, AiWindow] as unknown as mongoose.Model<Record<string, unknown>>[]) assert.equal(await model.countDocuments({ accountId: { $in: [a._id, guest._id] } }), 0);
    assert.equal(await AuthTicket.countDocuments({ accountId: a._id }), 0); assert.equal(await OAuthState.countDocuments({ initiatorId: a._id }), 0);
    assert.equal(await Account.countDocuments({ _id: { $in: [a._id, guest._id] } }), 0);
    assert.equal((await tenantRepository(Note, String(b._id)).find())[0]!.content, "keep");
});
test("partial deletion failure rolls back content cleanup and session revocation", async t => {
    const a = await user(), id = String(a._id);
    await tenantRepository(Task, id).create({ task: "Retain this task" });
    await tenantRepository(Note, id).create({ content: "Retain this note" });
    const { NotificationSettings } = await import("../modules/schedule-notifications/models.ts");
    t.mock.method(NotificationSettings, "deleteMany", async () => { throw new Error("isolated cleanup failure"); });
    await assert.rejects(deleteAccount(id), /isolated cleanup failure/);
    assert.equal(await Task.countDocuments({ accountId: id }), 1);
    assert.equal(await Note.countDocuments({ accountId: id }), 1);
    assert.equal((await Account.findById(id))!.sessionVersion, 0);
});

test("expired guests renew their own identity, data, onboarding and quotas without Google sign-in", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const guest = await Account.create({ cloudSyncEnabled: true, type: "guest", guestId: randomUUID(), onboardingCompleted: true });
    const id = String(guest._id);
    await tenantRepository(Note, id).create({ content: "Keep my guest note" });
    await withAiRequest(id, "guest-before-renewal", "f", async () => true);
    const expired = jwt.sign({ sub: id, type: "guest", version: 0, iat: Math.floor(Date.now() / 1000) - 8 * 86400 }, env.jwt.secret, { expiresIn: "7d", issuer: "alfred", audience: "alfred-api" });
    const headers = { Authorization: `Bearer ${expired}` };
    assert.equal((await fetch(`${base}/auth/session`, { headers })).status, 401);
    const response = await fetch(`${base}/auth/guest/renew`, { method: "POST", headers });
    assert.equal(response.status, 200);
    const renewed = await response.json() as { token: string; account: { id: string; type: string } };
    assert.equal(renewed.account.id, id); assert.equal(renewed.account.type, "guest");
    assert.equal((await request(renewed.token)).status, 200);
    assert.equal((await accountState(id)).onboardingCompleted, true); assert.equal((await aiUsage(id)).daily.used, 1);
    assert.equal((await tenantRepository(Note, id).find())[0]!.content, "Keep my guest note");
    await Account.updateOne({ _id: id }, { $inc: { sessionVersion: 1 } });
    assert.equal((await fetch(`${base}/auth/guest/renew`, { method: "POST", headers })).status, 401);
});
test("guest renewal rejects forged, stale, migrated, deleted and Google credentials", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const guest = await Account.create({ cloudSyncEnabled: true, type: "guest", guestId: randomUUID() }), target = await user();
    const stale = jwt.sign({ sub: String(guest._id), type: "guest", version: 0, iat: Math.floor(Date.now() / 1000) - 39 * 86400 }, env.jwt.secret, { expiresIn: "7d", issuer: "alfred", audience: "alfred-api" });
    const renew = (token: string) => fetch(`${base}/auth/guest/renew`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await renew("forged-token")).status, 401);
    assert.equal((await renew(stale)).status, 401);
    assert.equal((await renew(generateAuthToken(target))).status, 401);
    const token = generateAuthToken(guest);
    await Account.updateOne({ _id: guest._id }, { $set: { migratedTo: target._id } });
    assert.equal((await renew(token)).status, 401);
    await Account.deleteOne({ _id: guest._id });
    assert.equal((await renew(token)).status, 401);
    // Validating a user session must not refresh its recent-login timestamp.
    const userToken = generateAuthToken(target);
    const restored = await (await fetch(`${base}/auth/session`, { headers: { Authorization: `Bearer ${userToken}` } })).json() as { token: string };
    assert.equal(restored.token, userToken);
});
