import assert from "node:assert/strict";
import { before, after, test, mock } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { Account, type IAccount } from "../models/account.model.ts";
import { Task } from "../models/task.model.ts";
import { Note } from "../models/note.model.ts";
import { Schedule } from "../models/schedule.model.ts";
import { OAuthState } from "../models/oauthState.model.ts";
import { AuthTicket } from "../models/authTicket.model.ts";
import { NotificationSettings } from "../modules/schedule-notifications/models.ts";
import tasks from "../modules/tasks/route.ts";
import notes from "../modules/notes/route.ts";
import schedules from "../modules/schedule/route.ts";
import auth from "../modules/auth/auth.routes.ts";
import { env } from "../config/env.ts";
import { generateAuthToken, findOrCreateGoogleAccount, consumePendingOAuthState, atomicConsumeTicket } from "../modules/auth/auth.service.ts";
import { executeAiTool } from "../modules/ai/tools.ts";
import { tenantRepository } from "./tenantRepository.ts";
import { migrateGuest } from "./guestMigration.ts";
import { initializeSecurityIndexes, auditTenantDatabase, requireTransactionTopology } from "./indexes.ts";
import * as taskService from "../modules/tasks/service.ts";
import * as noteService from "../modules/notes/service.ts";
import * as scheduleService from "../modules/schedule/service.ts";
import { plan, claim, registerDevice, device } from "../modules/schedule-notifications/service.ts";

let database: MongoMemoryReplSet;
let server: ReturnType<express.Express["listen"]>;
let base = "";
let a: IAccount;
let b: typeof a;
let ga: typeof a;
let gb: typeof a;
const request = (path: string, token?: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual",
});
before(async () => {
    // Always isolated: no application URI is read or used for these fixtures.
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri("alfred_security_test"));
    await requireTransactionTopology();
    await initializeSecurityIndexes();
    a = await Account.create({ type: "user", googleId: "google-a" });
    b = await Account.create({ type: "user", googleId: "google-b" });
    ga = await Account.create({ type: "guest", guestId: randomUUID() });
    gb = await Account.create({ type: "guest", guestId: randomUUID() });
    const app = express(); app.use(express.json());
    app.use("/auth", auth); app.use("/tasks", tasks); app.use("/notes", notes); app.use("/schedules", schedules);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
}, { timeout: 180_000 });
after(async () => {
    mock.restoreAll();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await mongoose.disconnect();
    if (database) await database.stop();
});

test("real API: two users and two guests isolate every CRUD resource and reject mass assignment", async () => {
    for (const [path, payload, field] of [["/tasks", { task: "Private task" }, "task"], ["/notes", { title: "Private note", content: "private" }, "title"], ["/schedules", { time: "10:00", date: "2026-10-17", topic: "Private event" }, "topic"]] as const) {
        for (const owner of [a, b, ga, gb]) {
            const token = generateAuthToken(owner);
            const created = await request(path, token, "POST", payload);
            assert.equal(created.status, 201);
            const json = await created.json(); const row = json.schedule ?? json;
            assert.equal(String(row.accountId), String(owner._id));
            for (const intruder of [a, b, ga, gb].filter(x => String(x._id) !== String(owner._id))) {
                const other = generateAuthToken(intruder);
                assert.equal((await request(`${path}/${row._id}`, other, "PATCH", { [field]: "stolen" })).status, 404);
                assert.equal((await request(`${path}/${row._id}`, other, "DELETE")).status, 404);
                const list = await (await request(`${path}${path === "/schedules" ? "?date=2026-10-17" : ""}`, other)).json();
                assert.ok(!list.some((item: { _id: string }) => item._id === row._id));
            }
            assert.equal((await request(path, token, "POST", { ...payload, accountId: b._id, guestId: gb.guestId })).status, 400);
            assert.equal((await request(`${path}/${row._id}`, token, "PATCH", { $set: { accountId: b._id } })).status, 400);
            assert.equal((await request(`${path}/${row._id}`, token, "PATCH", { [field]: "Allowed edit" })).status, 200);
            assert.equal((await request(`${path}/${row._id}`, token, "DELETE")).status, 200);
        }
    }
});

test("real repositories: reads, counts, search, atomic toggle and bulk deletion stay scoped", async () => {
    const aid = String(a._id), bid = String(b._id);
    const ta = await taskService.addTask(aid, "A"), tb = await taskService.addTask(bid, "B");
    const na = await noteService.createNote(aid, "secret A"), nb = await noteService.createNote(bid, "secret B");
    const ra = tenantRepository(Task, aid);
    assert.equal(await ra.findOne({ _id: tb._id }), null);
    assert.equal(await ra.exists({ _id: tb._id }), null);
    assert.equal(await ra.countDocuments(), 1);
    assert.equal(await taskService.completeTask(aid, String(tb._id)), null);
    await Promise.all([taskService.completeTask(aid, String(ta._id)), taskService.completeTask(aid, String(ta._id))]);
    assert.equal((await ra.findOne({ _id: ta._id }))!.completed, false);
    assert.equal((await noteService.searchNotes(aid, "secret")).length, 1);
    assert.equal((await noteService.getRecentNotes(aid))[0]!._id.toString(), String(na._id));
    assert.equal(await noteService.touchNote(aid, String(nb._id)), null);
    await taskService.clearAllTasks(aid);
    assert.equal(await tenantRepository(Task, bid).countDocuments(), 1);
    assert.throws(() => tenantRepository(Task, ""), /context/);
    assert.throws(() => ra.create({ task: "bad", nested: { $set: { guestId: "forged" } } }), /Reserved/);
    assert.throws(() => ra.updateOne({ _id: ta._id }, { accountId: b._id }), /Reserved/);
    await assert.rejects(ra.find({ accountId: b._id }), /Reserved/);
    for (const method of ["save", "insertMany", "replaceOne", "aggregate", "bulkWrite", "collection", "updateMany"]) assert.equal((ra as Record<string, unknown>)[method], undefined);
});

test("real AI and notification paths preserve trusted ownership and reject foreign references", async () => {
    const event = await scheduleService.addSchedule(String(b._id), { date: "2026-10-17", time: "10:00", topic: "B only" });
    const result = await executeAiTool("updateScheduleEvent", JSON.stringify({ scheduleId: String(event._id), topic: "stolen", date: "2026-10-17", time: "11:00" }), String(a._id));
    assert.equal(result.success, false);
    const created = await executeAiTool("createTask", JSON.stringify({ task: "AI private", accountId: String(b._id) }), String(a._id));
    // Existing Zod tools strip unknown fields; model input never becomes identity.
    assert.equal(created.success, true);
    assert.ok((await taskService.getTasks(String(a._id))).some(t => t.task === "AI private"));
    assert.equal((await plan(String(a._id), "desktop", Date.parse("2026-10-17T09:50Z"))).reminders.length, 0);
    const secret = "a".repeat(64); const token = generateAuthToken(a);
    await registerDevice(String(a._id), secret, "desktop", token);
    assert.equal(await device(String(b._id), secret, token), null);
});

test("real authentication rejects tampering, expiry, wrong type, deleted accounts and spoofed guests", async () => {
    for (const token of ["invalid", generateAuthToken(ga).slice(0, -5) + "xxxxx", jwt.sign({ sub: ga._id.toString(), type: "guest" }, env.jwt.secret, { expiresIn: -1 }), jwt.sign({ sub: a._id.toString(), type: "guest" }, env.jwt.secret, { expiresIn: "1h" }), jwt.sign({ sub: new mongoose.Types.ObjectId().toString(), type: "user" }, env.jwt.secret, { expiresIn: "1h" })]) {
        assert.equal((await request("/tasks", token)).status, 401);
    }
    assert.equal((await request(`/tasks?guestId=${gb.guestId}`, generateAuthToken(ga))).status, 400);
    assert.equal((await request("/tasks")).status, 401);
    const token = generateAuthToken(b);
    assert.equal((await request("/auth/logout", token, "POST")).status, 204);
    assert.equal((await request("/tasks", token)).status, 401);
    b = (await Account.findById(b._id))!;
});

test("legacy bearer acceptance is explicit, bounded and never overrides issuer or audience", async () => {
    const saved = env.jwt.legacyAcceptUntil;
    const legacy = jwt.sign({ sub: b._id.toString(), type: "user", version: b.sessionVersion ?? 0 }, env.jwt.secret, { expiresIn: "1h" });
    try {
        env.jwt.legacyAcceptUntil = 0;
        assert.equal((await request("/tasks", legacy)).status, 401);
        env.jwt.legacyAcceptUntil = Date.now() + 3600_000;
        assert.equal((await request("/tasks", legacy)).status, 200);
        for (const context of [{ issuer: "wrong", audience: "alfred-api" }, { issuer: "alfred", audience: "wrong" }]) {
            const token = jwt.sign({ sub: b._id.toString(), type: "user", version: b.sessionVersion ?? 0 }, env.jwt.secret, { ...context, expiresIn: "1h" });
            assert.equal((await request("/tasks", token)).status, 401);
        }
    } finally { env.jwt.legacyAcceptUntil = saved; }
});

test("real migration transaction rolls back partial work and ticket failure; retries revoke guest access", async () => {
    const source = await Account.create({ type: "guest", guestId: randomUUID() });
    const task = await taskService.addTask(String(source._id), "Transfer me");
    await noteService.createNote(String(source._id), "Guest note");
    await scheduleService.addSchedule(String(source._id), { date: "2026-10-17", time: "12:00", topic: "Guest schedule" });
    await NotificationSettings.create({ accountId: source._id, timeZone: "UTC" });
    const token = generateAuthToken(source);
    await assert.rejects(migrateGuest(source._id, a._id, 0, async session => {
        await AuthTicket.create([{ ticket: "rolled-back-ticket", accountId: a._id, accountVersion: 0, flow: "browser", status: "issued", expiresAt: new Date(Date.now() + 90_000) }], { session });
        throw new Error("injected ticket failure");
    }), /injected/);
    assert.equal(await AuthTicket.countDocuments({ ticket: "rolled-back-ticket" }), 0);
    assert.equal(String((await Task.findById(task._id))!.accountId), String(source._id));
    assert.equal((await request("/tasks", token)).status, 200);
    await Promise.all([migrateGuest(source._id, a._id, 0), migrateGuest(source._id, a._id, 0)]);
    assert.equal(String((await Task.findById(task._id))!.accountId), String(a._id));
    assert.equal(await Note.countDocuments({ accountId: source._id }), 0);
    assert.equal(await Schedule.countDocuments({ accountId: source._id }), 0);
    assert.equal(await NotificationSettings.countDocuments({ accountId: a._id }), 1);
    assert.equal((await request("/tasks", token)).status, 401);
    await migrateGuest(source._id, a._id, 0);
    await assert.rejects(migrateGuest(source._id, b._id, 0), /already migrated/);
    assert.equal((await Account.findById(gb._id))!.migratedTo, undefined);
});

test("real concurrent migrations to different users commit exactly one owner", async () => {
    const source = await Account.create({ type: "guest", guestId: randomUUID() });
    const task = await taskService.addTask(String(source._id), "Race");
    const results = await Promise.allSettled([migrateGuest(source._id, a._id, 0), migrateGuest(source._id, b._id, 0)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const migrated = await Account.findById(source._id);
    assert.equal(String((await Task.findById(task._id))!.accountId), String(migrated!.migratedTo));
});

test("real OAuth state binds callback to its browser; canonical Google identity is race safe", async () => {
    const profile = { googleId: "repeated-google-sub", email: null, name: null, picture: null };
    const users = await Promise.all(Array.from({ length: 5 }, () => findOrCreateGoogleAccount(profile)));
    assert.equal(new Set(users.map(u => String(u._id))).size, 1);
    const verifier = "a".repeat(43), challenge = createHash("sha256").update(verifier).digest("base64url");
    const prepared = await request("/auth/prepare", generateAuthToken(ga), "POST", { flow: "browser", code_challenge: challenge });
    assert.equal(prepared.status, 200);
    const { state, url } = await prepared.json();
    const launch = await fetch(url.replace(env.google.callbackUrl.replace(/\/callback$/, ""), `${base}/auth/google`), { redirect: "manual" });
    assert.equal(launch.status, 302);
    const cookie = launch.headers.get("set-cookie")!.split(";")[0]!;
    const pending = await OAuthState.findOne({ state }); assert.ok(pending);
    assert.equal(await consumePendingOAuthState(state, "wrong-browser"), null);
    mock.method(OAuth2Client.prototype, "getToken", async () => ({ tokens: { id_token: "test-provider-token" } }));
    mock.method(OAuth2Client.prototype, "verifyIdToken", async () => ({ getPayload: () => ({ sub: profile.googleId, nonce: pending.nonce }) }));
    try {
        const callback = await fetch(`${base}/auth/google/callback?state=${state}&code=verified-code`, { headers: { Cookie: cookie }, redirect: "manual" });
        assert.equal(callback.status, 302);
        const location = callback.headers.get("location")!; assert.ok(location.includes("ticket="));
        const ticket = new URL(location).searchParams.get("ticket")!;
        assert.equal(await atomicConsumeTicket({ ticket, codeVerifier: "wrong" }), null);
        const session = await atomicConsumeTicket({ ticket, codeVerifier: verifier }); assert.ok(session);
        assert.equal(session.account.id, String(users[0]!._id));
        assert.equal(await atomicConsumeTicket({ ticket, codeVerifier: verifier }), null);
        assert.equal((await request("/tasks", generateAuthToken(ga))).status, 401);
        assert.equal(await consumePendingOAuthState(state, cookie.split("=")[1]!), null);
    } finally { mock.restoreAll(); }
});

test("real indexes support scoped sorts and legacy ownership stays quarantined", async () => {
    await Task.collection.insertOne({ task: "Unowned" } as never);
    await Task.collection.insertOne({ accountId: a._id, guestId: "conflicting", task: "Ambiguous" } as never);
    assert.ok(!(await taskService.getTasks(String(a._id))).some(t => ["Unowned", "Ambiguous"].includes(t.task)));
    const report = await auditTenantDatabase();
    const tasks = report.find(r => r.collection === Task.collection.name)!;
    assert.equal(tasks.malformedOwner, 1); assert.equal(tasks.conflictingGuestField, 1);
    assert.ok(tasks.indexes.some(index => JSON.stringify(index.key) === JSON.stringify({ accountId: 1, createdAt: -1 })));
    const explanation = await Task.find({ accountId: a._id }).sort({ createdAt: -1 }).hint({ accountId: 1, createdAt: -1 }).explain("executionStats");
    assert.ok(JSON.stringify(explanation).includes("IXSCAN"));
});

test("real migration supports legacy guest versions and preserves existing account preferences", async () => {
    const id = new mongoose.Types.ObjectId();
    await Account.collection.insertOne({ _id: id, type: "guest", guestId: randomUUID(), createdAt: new Date(), updatedAt: new Date() });
    await NotificationSettings.create({ accountId: id, timeZone: "Asia/Kolkata" });
    const original = await NotificationSettings.findOne({ accountId: a._id }).lean();
    await migrateGuest(id, a._id, 0);
    assert.equal((await NotificationSettings.findOne({ accountId: a._id }))!.timeZone, original!.timeZone);
    assert.equal((await NotificationSettings.findOne({ accountId: id }))!.timeZone, "Asia/Kolkata");
});

test("guest write fence prevents stranded creates while migration is in flight", async () => {
    const source = await Account.create({ type: "guest", guestId: randomUUID() });
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const transfer = migrateGuest(source._id, a._id, 0, async () => { entered(); await gate; });
    await ready;
    const lateWrite = taskService.addTask(String(source._id), "Late write");
    release();
    const [, result] = await Promise.allSettled([transfer, lateWrite]);
    assert.equal(result.status, "rejected");
    assert.equal(await Task.countDocuments({ accountId: source._id }), 0);
    await assert.rejects(taskService.addTask(String(source._id), "Stale guest"), /active/);
});

test("notification migration preserves claim idempotency and invalidates device sessions", async () => {
    const source = await Account.create({ type: "guest", guestId: randomUUID() });
    const target = await Account.create({ type: "user", googleId: "notification-transfer-google" });
    const now = Date.parse("2026-10-17T09:50Z");
    await NotificationSettings.create({ accountId: source._id, timeZone: "UTC" });
    await scheduleService.addSchedule(String(source._id), { date: "2026-10-17", time: "10:00", topic: "Transfer reminder" });
    const key = (await plan(String(source._id), "desktop", now)).reminders[0]!.key;
    const secret = "b".repeat(64), token = generateAuthToken(source);
    await registerDevice(String(source._id), secret, "desktop", token);
    const installation = await device(String(source._id), secret, token);
    assert.ok(installation);
    assert.ok(await claim(String(source._id), installation._id, "desktop", key, now));
    await migrateGuest(source._id, target._id, 0);
    assert.equal(await device(String(target._id), secret, token), null);
    assert.equal(await claim(String(target._id), installation._id, "desktop", key, now), null);
});

test("desktop OAuth handoff requires the prepared verifier and cannot be replayed", async () => {
    const source = await Account.create({ type: "guest", guestId: randomUUID() });
    const verifier = "b".repeat(43), challenge = createHash("sha256").update(verifier).digest("base64url");
    const prepared = await (await request("/auth/prepare", generateAuthToken(source), "POST", { flow: "desktop", code_challenge: challenge })).json();
    const launch = await request(`/auth/google?state=${prepared.state}`);
    const cookie = launch.headers.get("set-cookie")!.split(";")[0]!;
    const pending = await OAuthState.findOne({ state: prepared.state }); assert.ok(pending);
    mock.method(OAuth2Client.prototype, "getToken", async () => ({ tokens: { id_token: "test-token" } }));
    mock.method(OAuth2Client.prototype, "verifyIdToken", async () => ({ getPayload: () => ({ sub: "desktop-google", nonce: pending.nonce }) }));
    try {
        const callback = await fetch(`${base}/auth/google/callback?state=${prepared.state}&code=test`, { headers: { Cookie: cookie } });
        assert.equal(callback.status, 200);
        assert.equal((await request("/auth/desktop-poll", undefined, "POST", { state: prepared.state, code_verifier: "c".repeat(43) })).status, 404);
        assert.equal((await request("/auth/desktop-poll", undefined, "POST", { state: prepared.state, code_verifier: verifier })).status, 200);
        assert.equal((await request("/auth/desktop-poll", undefined, "POST", { state: prepared.state, code_verifier: verifier })).status, 404);
        assert.equal(await Account.countDocuments({ googleId: "desktop-google" }), 1);
    } finally { mock.restoreAll(); }
});

test("OAuth nonce mismatch and migration failure never issue a successful handoff", async () => {
    const source = await Account.create({ type: "guest", guestId: randomUUID() });
    const verifier = "d".repeat(43), challenge = createHash("sha256").update(verifier).digest("base64url");
    for (const failure of ["nonce", "transaction"]) {
        const prepared = await (await request("/auth/prepare", generateAuthToken(source), "POST", { flow: "browser", code_challenge: challenge })).json();
        const launch = await request(`/auth/google?state=${prepared.state}`);
        const cookie = launch.headers.get("set-cookie")!.split(";")[0]!;
        const pending = await OAuthState.findOne({ state: prepared.state }); assert.ok(pending);
        mock.method(OAuth2Client.prototype, "getToken", async () => ({ tokens: { id_token: "test-token" } }));
        mock.method(OAuth2Client.prototype, "verifyIdToken", async () => ({ getPayload: () => ({ sub: "failure-google", nonce: failure === "nonce" ? "wrong-nonce" : pending.nonce }) }));
        if (failure === "transaction") mock.method(mongoose.connection, "transaction", async () => { throw new Error("injected deployment failure"); });
        try {
            const callback = await fetch(`${base}/auth/google/callback?state=${prepared.state}&code=test`, { headers: { Cookie: cookie }, redirect: "manual" });
            assert.ok(callback.headers.get("location")!.includes("auth_error=authentication_failed"));
            assert.equal(await AuthTicket.countDocuments({ state: prepared.state }), 0);
            assert.equal((await Account.findById(source._id))!.migratedTo, undefined);
            assert.equal((await request("/tasks", generateAuthToken(source))).status, 200);
        } finally { mock.restoreAll(); }
    }
});
