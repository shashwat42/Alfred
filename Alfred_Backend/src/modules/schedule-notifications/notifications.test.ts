import assert from "node:assert/strict";
import { test, mock, type TestContext } from "node:test";
import mongoose from "mongoose";
import { defaultPreferences, eventInstant, remindersFor, eligible, isDue, type Preferences } from "./policy.ts";
import { Schedule } from "../../models/schedule.model.ts";
import { NotificationSettings, NotificationDevice, NotificationDelivery } from "./models.ts";
import { preferences, savePreferences, registerDevice, device, plan, claim } from "./service.ts";
import * as scheduleService from "../schedule/service.ts";

const account = "111111111111111111111111", other = "222222222222222222222222";
const id = "333333333333333333333333";
const now = Date.parse("2026-10-17T09:50:00Z");
const defaults = (): Preferences => ({ ...defaultPreferences(), timeZone: "UTC" });
const event = () => ({ _id: new mongoose.Types.ObjectId(id), accountId: new mongoose.Types.ObjectId(account), date: "2026-10-17", time: "10:00", topic: "Call Sam", createdAt: new Date(now), updatedAt: new Date(now) });
type Event = ReturnType<typeof event>;

/** Persistent repository fixture: models only Mongo operations, not reminder policy.
 * Production unique _id enforcement is represented by synchronous Map insertion.
 * No live MongoDB or production database is used by these tests. */
function fixture(t: TestContext, p: Preferences | null = defaults()) {
    const rows = new Map<string, Event>([[id, event()]]);
    const sent = new Map<string, unknown>();
    const installations = new Map<string, Record<string, unknown>>();
    let settings = p;
    const owned = (filter: Record<string, unknown>, row: Event) => String(row.accountId) === String(filter.accountId) && (!filter._id || String(row._id) === String(filter._id));
    mock.method(NotificationSettings, "findOne", ((filter: Record<string, unknown>) => ({ lean: async () => filter.accountId === account && settings ? { ...settings } : null })) as never);
    mock.method(NotificationSettings, "create", ((input: Preferences) => { if (settings) throw Object.assign(new Error("duplicate"), { code: 11000 }); settings = { ...input }; return Promise.resolve(input); }) as never);
    mock.method(NotificationSettings, "updateOne", (async (filter: { accountId: string; revision: number }, update: { $set: Preferences }) => {
        if (filter.accountId !== account || settings?.revision !== filter.revision) return { modifiedCount: 0 };
        settings = { ...update.$set }; return { modifiedCount: 1 };
    }) as never);
    mock.method(Schedule, "find", ((filter: Record<string, unknown>) => ({ sort: () => ({ limit: (count: number) => ({ lean: async () => {
        const range = filter.date as { $gte: string; $lte: string };
        const cursor = filter.$or as Array<{ date: string | { $gt: string }; _id?: { $gt: string } }> | undefined;
        return [...rows.values()].filter(row => String(row.accountId) === String(filter.accountId) && row.date >= range.$gte && row.date <= range.$lte && (!cursor || row.date > (cursor[0]!.date as { $gt: string }).$gt || (row.date === cursor[1]!.date && String(row._id) > cursor[1]!._id!.$gt)))
            .sort((a, b) => a.date.localeCompare(b.date) || String(a._id).localeCompare(String(b._id))).slice(0, count);
    } }) }) })) as never);
    mock.method(Schedule, "findOne", ((filter: Record<string, unknown>) => ({ lean: async () => [...rows.values()].find(row => owned(filter, row)) ?? null })) as never);
    mock.method(Schedule, "exists", (async (filter: Record<string, unknown>) => [...rows.values()].some(row => owned(filter, row) && row.updatedAt === filter.updatedAt) ? { _id: id } : null) as never);
    mock.method(Schedule, "create", (async (input: Omit<Event, "_id" | "createdAt" | "updatedAt">) => { const row = { ...event(), ...input }; rows.set(String(row._id), row); return { toObject: () => row }; }) as never);
    mock.method(Schedule, "findOneAndUpdate", ((filter: Record<string, unknown>, update: { $set: Partial<Event> }) => ({ lean: async () => {
        const row = [...rows.values()].find(row => owned(filter, row)); if (!row) return null;
        Object.assign(row, update.$set, { updatedAt: new Date(now + 1) }); return row;
    } })) as never);
    mock.method(Schedule, "findOneAndDelete", ((filter: Record<string, unknown>) => ({ lean: async () => { const row = [...rows.values()].find(row => owned(filter, row)); if (row) rows.delete(String(row._id)); return row ?? null; } })) as never);
    mock.method(NotificationDelivery, "create", (async (input: { _id: string }) => {
        if (sent.has(input._id)) throw Object.assign(new Error("duplicate"), { code: 11000 });
        sent.set(input._id, input); return input;
    }) as never);
    mock.method(NotificationDevice, "findOneAndUpdate", (async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => { installations.set(filter._id, { _id: filter._id, ...update.$set }); }) as never);
    mock.method(NotificationDevice, "findOne", ((filter: Record<string, unknown>) => ({ lean: async () => {
        const d = installations.get(String(filter._id));
        const after = (filter.expiresAt as { $gt: Date }).$gt;
        return d && String(d.accountId) === String(filter.accountId) && d.sessionHash === filter.sessionHash && (d.expiresAt as Date) > after ? d : null;
    } })) as never);
    t.after(() => mock.restoreAll());
    return { rows, sent, installations, change: (next: Preferences) => { settings = next; } };
}

test("legacy schedules get a ten-minute default lead reminder", () => {
    const list = remindersFor(event(), defaults());
    assert.equal(list.length, 1); assert.equal(list[0]!.dueAt, now);
    assert.equal(defaultPreferences().destination, "both");
    assert.equal(list[0]!.title, "Call Sam");
});
test("strict legacy time parsing handles midnight, noon, 24h and invalid prose", () => {
    for (const [time, iso] of [["12 AM", "00:00"], ["12:30 PM", "12:30"], ["23:59", "23:59"], ["9 am", "09:00"]]) assert.equal(eventInstant("2026-10-17", time!, "UTC"), Date.parse(`2026-10-17T${iso}:00Z`));
    for (const time of ["tomorrow morning", "25:00", "9:99", "0 PM", "13 PM", ""]) assert.equal(eventInstant("2026-10-17", time, "UTC"), null);
    assert.equal(eventInstant("2026-02-30", "10:00", "UTC"), null);
    assert.equal(eventInstant("", "10:00", "UTC"), null);
});
test("IANA zones and DST gaps/folds resolve deterministically", () => {
    assert.equal(eventInstant("2026-10-17", "10:00", "Asia/Kolkata"), Date.parse("2026-10-17T04:30Z"));
    assert.equal(eventInstant("2026-03-08", "02:30", "America/New_York"), null);
    assert.equal(eventInstant("2026-11-01", "01:30", "America/New_York"), Date.parse("2026-11-01T05:30Z"));
    assert.equal(eventInstant("2026-10-17", "10:00", "bad-zone"), null);
});
test("additional start reminder and zero-minute lead have no duplicate start", () => {
    assert.deepEqual(remindersFor(event(), { ...defaults(), atStart: true }).map(r => r.kind), ["lead", "start"]);
    assert.equal(remindersFor(event(), { ...defaults(), atStart: true, leadMinutes: 0 }).length, 1);
    const zero = remindersFor(event(), { ...defaults(), leadMinutes: 0 })[0]!;
    assert.equal(isDue(zero, zero.eventAt + 1000), true);
});
test("occurrences on different dates and separate recurring records have distinct keys", () => {
    const first = remindersFor(event(), defaults())[0]!;
    assert.notEqual(first.key, remindersFor({ ...event(), date: "2026-10-18" }, defaults())[0]!.key);
    assert.notEqual(first.key, remindersFor({ ...event(), _id: other }, defaults())[0]!.key);
});
test("preference changes affect future reminders without reviving cancelled delivery windows", () => {
    assert.equal(remindersFor(event(), { ...defaults(), effectiveFrom: now + 1 }).length, 0);
    assert.equal(remindersFor(event(), { ...defaults(), effectiveFrom: now - 1 }).length, 1);
});
test("past lead windows and already-started events do not deliver", () => {
    const reminder = remindersFor(event(), defaults())[0]!;
    assert.equal(isDue(reminder, now - 1), false);
    assert.equal(isDue(reminder, now + 120_001), false);
    assert.equal(isDue({ ...reminder, dueAt: reminder.eventAt - 30_000 }, reminder.eventAt + 1), false);
    const start = remindersFor(event(), { ...defaults(), atStart: true })[1]!;
    assert.equal(isDue(start, start.eventAt + 1), true);
    assert.equal(isDue(start, start.eventAt + 120_001), false);
});
for (const destination of ["mobile", "desktop", "both"] as const) test(`${destination} enforces actual device routing`, async t => {
    fixture(t, { ...defaults(), destination });
    for (const platform of ["mobile", "desktop"] as const) {
        const expected = destination === "both" || destination === platform;
        assert.equal(eligible({ ...defaults(), destination }, platform), expected);
        assert.equal((await plan(account, platform, now)).reminders.length, expected ? 1 : 0);
        assert.equal(Boolean(await claim(account, `device-${platform}`, platform, remindersFor(event(), defaults())[0]!.key, now)), expected);
    }
});
test("shared service creation used by dashboard and AI creates the same plan", async t => {
    const f = fixture(t); f.rows.clear();
    await scheduleService.addSchedule(account, { time: "10:00", date: "2026-10-17", topic: "AI-created event" });
    const result = await plan(account, "desktop", now);
    assert.equal(result.reminders[0]!.dueAt, now); assert.equal(result.reminders[0]!.title, "AI-created event");
});
test("editing the shared schedule service invalidates the old occurrence immediately", async t => {
    fixture(t); const old = remindersFor(event(), defaults())[0]!;
    await scheduleService.updateSchedule(account, id, { time: "11:00" });
    assert.equal(await claim(account, "d", "desktop", old.key, now), null);
    assert.equal((await plan(account, "desktop", now)).reminders[0]!.dueAt, now + 3600_000);
});
test("deletion (existing cancellation path) removes pending reminders", async t => {
    fixture(t); const key = remindersFor(event(), defaults())[0]!.key;
    await scheduleService.deleteSchedule(account, id);
    assert.equal((await plan(account, "desktop", now)).reminders.length, 0);
    assert.equal(await claim(account, "d", "desktop", key, now), null);
});
test("disabled preferences suppress plans and old native alarm claims", async t => {
    fixture(t, { ...defaults(), enabled: false });
    assert.equal((await plan(account, "mobile", now)).reminders.length, 0);
    assert.equal(await claim(account, "d", "mobile", remindersFor(event(), defaults())[0]!.key, now), null);
});
test("reconciliation is idempotent; concurrent claims and restarted coordinators cannot duplicate", async t => {
    const f = fixture(t);
    const key = (await plan(account, "desktop", now)).reminders[0]!.key;
    assert.deepEqual(await plan(account, "desktop", now), await plan(account, "desktop", now));
    const results = await Promise.all(Array.from({ length: 20 }, () => claim(account, "device", "desktop", key, now)));
    assert.equal(results.filter(Boolean).length, 1); assert.equal(f.sent.size, 1);
    assert.equal(await claim(account, "device", "desktop", key, now + 1), null);
});
test("each installation on the same platform gets one eligible delivery", async t => {
    fixture(t); const key = remindersFor(event(), defaults())[0]!.key;
    assert.ok(await claim(account, "desktop-one", "desktop", key, now));
    assert.ok(await claim(account, "desktop-two", "desktop", key, now));
    assert.ok(await claim(account, "mobile-one", "mobile", key, now));
});
test("preference switches apply immediately without reviving an already claimed reminder", async t => {
    const f = fixture(t); const key = remindersFor(event(), defaults())[0]!.key;
    assert.ok(await claim(account, "d", "desktop", key, now));
    f.change({ ...defaults(), destination: "mobile", revision: 1 });
    assert.equal(await claim(account, "other", "desktop", key, now), null);
    f.change({ ...defaults(), destination: "both", revision: 2 });
    assert.equal(await claim(account, "d", "desktop", key, now), null);
});
test("account identity scopes schedules, preferences and claims", async t => {
    fixture(t, { ...defaults(), destination: "mobile" });
    assert.equal((await preferences(other)).destination, "both");
    assert.equal((await plan(other, "desktop", now)).reminders.length, 0);
    assert.equal(await claim(other, "d", "desktop", remindersFor(event(), defaults())[0]!.key, now), null);
    assert.equal(await scheduleService.deleteSchedule(other, id), null);
});
test("device registration is bound to installation capability, account, session and expiry", async t => {
    fixture(t); const secret = "a".repeat(64);
    await registerDevice(account, secret, "mobile", "token-one", now);
    assert.ok(await device(account, secret, "token-one", now));
    assert.equal(await device(other, secret, "token-one", now), null);
    assert.equal(await device(account, secret, "revoked-token", now), null);
    assert.equal(await device(account, "b".repeat(64), "token-one", now), null);
    assert.equal(await device(account, secret, "token-one", now + 31 * 86400_000), null);
    await registerDevice(other, secret, "mobile", "token-two", now);
    assert.equal(await device(account, secret, "token-one", now), null);
    assert.ok(await device(other, secret, "token-two", now));
});
test("concurrent settings use revision compare-and-swap", async t => {
    fixture(t, null);
    const initial = await Promise.all([savePreferences(account, defaults()), savePreferences(account, defaults())]);
    assert.equal(initial.filter(Boolean).length, 1);
    const saved = await preferences(account);
    const result = await Promise.all([savePreferences(account, { ...saved, leadMinutes: 30 }), savePreferences(account, { ...saved, leadMinutes: 60 })]);
    assert.equal(result.filter(Boolean).length, 1); assert.equal((await preferences(account)).revision, 2);
});
test("backend restart reconstructs future reminders solely from existing schedules", async t => {
    fixture(t);
    assert.equal((await plan(account, "desktop", now - 86400_000)).reminders.length, 1);
    assert.equal((await plan(account, "desktop", now)).reminders.length, 1);
    assert.equal((await plan(account, "desktop", now + 180_000)).reminders.length, 0);
});
test("bounded indexed pagination returns every occurrence without duplicates", async t => {
    const f = fixture(t); f.rows.clear();
    for (let i = 0; i < 205; i++) { const row = { ...event(), _id: new mongoose.Types.ObjectId(i.toString(16).padStart(24, "0")) }; f.rows.set(String(row._id), row); }
    const first = await plan(account, "desktop", now);
    assert.equal(first.reminders.length, 200); assert.ok(first.next);
    const next = await plan(account, "desktop", now, first.next!);
    assert.equal(next.reminders.length, 5); assert.equal(next.next, null);
    assert.equal(new Set([...first.reminders, ...next.reminders].map(r => r.key)).size, 205);
});
test("failed delivery persistence cannot corrupt a saved schedule", async t => {
    const f = fixture(t);
    mock.method(NotificationDelivery, "create", (async () => { throw new Error("database unavailable"); }) as never);
    await assert.rejects(claim(account, "d", "desktop", remindersFor(event(), defaults())[0]!.key, now));
    assert.equal(f.rows.get(id)!.topic, "Call Sam"); assert.equal(f.rows.size, 1);
});

test("AI tool calls use the same schedule source and reminder policy", async t => {
    fixture(t);
    const { executeAiTool } = await import("../ai/tools.ts");
    const result = await executeAiTool("createScheduleEvent", JSON.stringify({ date: "2026-10-17", time: "10:00", topic: "AI schedule notification test" }), account);
    assert.ok(result.action);
    assert.equal((await plan(account, "mobile", now)).reminders[0]!.title, "AI schedule notification test");
});
test("tasks and notes never produce schedule reminders", async t => {
    const f = fixture(t); f.rows.clear();
    const { Task } = await import("../../models/task.model.ts");
    const { Note } = await import("../../models/note.model.ts");
    mock.method(Task, "create", (async (input: Record<string, unknown>) => ({ toObject: () => ({ ...input, _id: new mongoose.Types.ObjectId() }) })) as never);
    mock.method(Note, "create", (async (input: Record<string, unknown>) => ({ toObject: () => ({ ...input, _id: new mongoose.Types.ObjectId() }) })) as never);
    const { executeAiTool } = await import("../ai/tools.ts");
    assert.ok((await executeAiTool("createTask", JSON.stringify({ task: "A task with no reminder" }), account)).success);
    assert.ok((await executeAiTool("createNote", JSON.stringify({ title: "A note", content: "No reminder" }), account)).success);
    assert.equal((await plan(account, "desktop", now)).reminders.length, 0);
    assert.equal(f.sent.size, 0);
});

async function api(t: TestContext) {
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL", "MONGODB_URI", "JWT_SECRET"]) process.env[key] = "isolated-notification-test";
    const express = (await import("express")).default;
    const jwt = (await import("jsonwebtoken")).default;
    const { Account } = await import("../../models/account.model.ts");
    const { env } = await import("../../config/env.ts");
    const { default: router } = await import("./route.ts");
    mock.method(Account, "findById", (async (sub: string) => ({ _id: new mongoose.Types.ObjectId(sub), type: "user" })) as never);
    mock.method(Date, "now", () => now);
    const app = express(); app.use(express.json()); app.use("/notifications", router);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const port = (server.address() as { port: number }).port;
    const call = (path: string, body?: unknown, who: string | null = account, method = body === undefined ? "GET" : "POST") => fetch(`http://127.0.0.1:${port}/notifications${path}`, {
        method, headers: { ...(who ? { Authorization: `Bearer ${jwt.sign({ sub: who }, env.jwt.secret)}` } : {}), "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return call;
}

test("authenticated API rejects missing sessions, spoofed identity and invalid settings", async t => {
    fixture(t); const call = await api(t);
    assert.equal((await call("/preferences", undefined, null)).status, 401);
    assert.equal((await call("/preferences", { ...defaults(), accountId: other }, account, "PUT")).status, 400);
    assert.equal((await call("/preferences", { ...defaults(), timeZone: "invalid" }, account, "PUT")).status, 400);
    assert.equal((await call("/preferences", { ...defaults(), leadMinutes: -1 }, account, "PUT")).status, 400);
    assert.equal((await call("/devices", { secret: "a".repeat(64), platform: "mobile", accountId: other })).status, 400);
});
test("API device capabilities and account scoping protect reminder plans and claims", async t => {
    fixture(t); const call = await api(t); const secret = "a".repeat(64);
    assert.equal((await call("/devices", { secret, platform: "desktop" })).status, 204);
    assert.equal((await call("/sync", { secret }, other)).status, 403);
    assert.equal((await call("/sync", { secret: "b".repeat(64) })).status, 403);
    const response = await call("/sync", { secret });
    assert.equal(response.status, 200);
    const data = await response.json() as { reminders: Array<{ key: string }> };
    assert.equal(data.reminders.length, 1);
    const body = { secret, key: data.reminders[0]!.key };
    assert.equal((await call("/claim", body)).status, 200);
    assert.equal((await call("/claim", body)).status, 204);
    assert.equal((await call("/claim", { secret, key: "$ne" })).status, 400);
});
test("API concurrent preference changes report conflict instead of overwriting", async t => {
    fixture(t, null); const call = await api(t);
    const responses = await Promise.all([call("/preferences", defaults(), account, "PUT"), call("/preferences", { ...defaults(), destination: "mobile" }, account, "PUT")]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
});
test("delivery failures produce a contained API error and preserve event data", async t => {
    const f = fixture(t); const call = await api(t); const secret = "a".repeat(64);
    await call("/devices", { secret, platform: "mobile" });
    mock.method(NotificationDelivery, "create", (async () => { throw new Error("unavailable"); }) as never);
    assert.equal((await call("/claim", { secret, key: remindersFor(event(), defaults())[0]!.key })).status, 503);
    assert.equal(f.rows.get(id)!.topic, "Call Sam");
});
