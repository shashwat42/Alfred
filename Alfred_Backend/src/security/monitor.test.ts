import "./testEnvironment.ts";
import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { OAuth2Client, LoginTicket } from "google-auth-library";
import jwt from "jsonwebtoken";
import { Activity } from "../modules/monitor/activity.ts";
import { OnDemandSnapshot, resources, atlasStats } from "../modules/monitor/metrics.ts";
import { ADMIN_EMAIL, isOwner, checkPassword, hashPassword, MonitorAdmin, finishGoogle } from "../modules/monitor/auth.ts";
import { createMonitorRouter } from "../modules/monitor/route.ts";
import { env } from "../config/env.ts";

let database: MongoMemoryServer;
let server: ReturnType<express.Express["listen"]>;
let base: string;
before(async () => {
    database = await MongoMemoryServer.create(); await mongoose.connect(database.getUri());
    const app = express(); app.use("/monitor", createMonitorRouter(() => false));
    app.get("/auth/google/callback", finishGoogle);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
});
after(async () => { mock.restoreAll(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); await database?.stop(); });
const origin = new URL(env.google.callbackUrl).origin;
const post = (path: string, password: string, cookie = "", source = origin) => fetch(`${base}/monitor/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: source, Cookie: cookie }, body: JSON.stringify({ password }),
});
function cookies(response: Response) { return response.headers.getSetCookie().map(s => s.split(";")[0]).join("; "); }

test("owner verification requires exact email, verified claim, subject and nonce", () => {
    const payload = { email: ADMIN_EMAIL, email_verified: true, sub: "google-owner", nonce: "nonce" };
    assert.equal(isOwner(payload, "nonce"), true);
    for (const invalid of [{ ...payload, email: "another@gmail.com" }, { ...payload, email_verified: false },
        { ...payload, nonce: "wrong" }, { ...payload, sub: "" }]) assert.equal(isOwner(invalid, "nonce"), false);
});
test("password hashes use independent salts and verify without storing plaintext", async () => {
    const password = "a-long-private-password";
    const first = await hashPassword(password), second = await hashPassword(password);
    assert.notEqual(first, second); assert.ok(!first.includes(password));
    assert.equal(await checkPassword(password, first), true); assert.equal(await checkPassword("incorrect-password", first), false);
});
test("dashboard data is protected and cross-origin password writes are rejected", async () => {
    assert.equal((await fetch(`${base}/monitor/metrics`)).status, 401);
    assert.equal((await post("password", "a-long-private-password")).status, 403);
    assert.equal((await post("login", "a-long-private-password", "", "https://attacker.test")).status, 403);
    const page = await fetch(`${base}/monitor`); assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
});
async function googleProof(email = ADMIN_EMAIL, validState = true) {
    const start = await fetch(`${base}/monitor/google`, { redirect: "manual" });
    const location = new URL(start.headers.get("location")!);
    const state = location.searchParams.get("state")!, nonce = location.searchParams.get("nonce")!;
    mock.method(OAuth2Client.prototype, "getToken", async () => ({ tokens: { id_token: "stub-identity" } }));
    mock.method(OAuth2Client.prototype, "verifyIdToken", async () => new LoginTicket("stub", {
        iss: "https://accounts.google.com", aud: env.google.clientId, sub: "owner-subject", iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: true, nonce,
    }));
    try { return await fetch(`${base}/auth/google/callback?state=${validState ? state : "monitor_wrong"}&code=stub-code`, {
        redirect: "manual", headers: { Cookie: cookies(start) },
    }); } finally { mock.restoreAll(); }
}
test("OAuth rejects another Google account and mismatched state before password setup", async () => {
    assert.match((await googleProof("attacker@gmail.com")).headers.get("location")!, /error=verification/);
    assert.equal(await MonitorAdmin.countDocuments({}), 0);
    assert.match((await googleProof(ADMIN_EMAIL, false)).headers.get("location")!, /error=verification/);
    assert.equal(await MonitorAdmin.countDocuments({}), 0);
});
test("verified owner sets password once, signs in, resets and revokes older sessions", async () => {
    const proof = cookies(await googleProof()); assert.match(proof, /alfred_monitor_proof=/);
    const state = await fetch(`${base}/monitor/auth-state`, { headers: { Cookie: proof } }); assert.equal((await state.json()).verified, true);
    const saved = await post("password", "first-owner-password", proof); assert.equal(saved.status, 200);
    const session = cookies(saved); assert.match(saved.headers.get("set-cookie")!, /HttpOnly/i);
    assert.equal((await post("password", "reuse-proof-password", proof)).status, 403);
    assert.equal((await post("login", "wrong-owner-password")).status, 401);
    assert.equal((await post("login", "first-owner-password")).status, 200);
    // Invalid sessions fail before any metric provider is contacted.
    const forged = jwt.sign({ version: "forged" }, env.jwt.secret, { issuer: "alfred", audience: "alfred-api" });
    assert.equal((await fetch(`${base}/monitor/metrics`, { headers: { Cookie: `alfred_monitor_session=${forged}` } })).status, 401);
    const nextProof = cookies(await googleProof());
    const reset = await post("password", "second-owner-password", nextProof); assert.equal(reset.status, 200);
    assert.equal((await fetch(`${base}/monitor/metrics`, { headers: { Cookie: session } })).status, 401);
    const admin = await MonitorAdmin.findById("dashboard-owner").lean();
    assert.equal(admin?.googleSub, "owner-subject"); assert.equal(admin?.proofHash, undefined);
    assert.equal(await checkPassword("second-owner-password", admin!.passwordHash!), true);
    const originalFetch = globalThis.fetch;
    let probes = 0;
    mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
        if (String(input).startsWith(base)) return originalFetch(input, options);
        probes++; return new Response("{}", { status: 200 });
    });
    try {
        const validSession = cookies(reset);
        const response = await fetch(`${base}/monitor/metrics`, { headers: { Cookie: validSession } });
        assert.equal(response.status, 200);
        const metrics = await response.json(); assert.equal(metrics.backend.status, "unavailable", "standalone test DB is not a production transaction topology");
        assert.equal(metrics.services.ai.status, "not configured");
        assert.equal(metrics.atlas.status, "ok"); assert.equal(metrics.atlas.limitBytes, null);
        assert.ok(JSON.stringify(metrics).length < 16_384, "cached snapshot must stay small");
        assert.ok(!JSON.stringify(metrics).includes("owner-subject"));
        await fetch(`${base}/monitor/metrics`, { headers: { Cookie: validSession } }); assert.equal(probes, 2, "second request must reuse Google/GitHub probes");
        await fetch(`${base}/monitor/logout`, { method: "POST", headers: { Cookie: validSession, Origin: origin, "Content-Type": "application/json" }, body: "{}" });
        assert.equal((await fetch(`${base}/monitor/metrics`, { headers: { Cookie: validSession } })).status, 401);
    } finally { mock.restoreAll(); }
});
test("on-demand sampling stays lazy, shares simultaneous requests, caches and retries failures", async () => {
    let calls = 0;
    const sampler = new OnDemandSnapshot(async () => { calls++; return calls; });
    assert.equal(calls, 0);
    assert.deepEqual(await Promise.all([sampler.get(), sampler.get()]), [1, 1]);
    assert.equal(await sampler.get(), 1); assert.equal(calls, 1);
    await sampler.get(Date.now() + 31_000); assert.equal(calls, 2);
    let fail = true;
    const failed = new OnDemandSnapshot(async () => { if (fail) throw new Error("fixture"); return 3; });
    await assert.rejects(failed.get()); fail = false; assert.equal(await failed.get(), 3);
});
test("presence deduplicates accounts, expires and has a fixed capacity", () => {
    const activity = new Activity();
    activity.touch("one", 0); activity.touch("one", 1); activity.touch("two", 2);
    assert.equal(activity.snapshot(3).activeAccounts5m, 2);
    assert.equal(activity.snapshot(300_003).activeAccounts5m, 0);
    for (let i = 0; i < 10_050; i++) activity.touch(`id-${i}`, 400_000);
    assert.equal(activity.snapshot(400_001).activeAccounts5m, 10_000);
    activity.record(200, 20, 600_000); activity.record(503, 40, 600_001);
    assert.deepEqual(activity.snapshot(660_000).previousMinute, { requests: 2, errors: 1, averageLatencyMs: 30 });
});
test("resource and database statistics are aggregate-only and bounded", async () => {
    const stats = await resources(); assert.ok(stats.process.rssBytes > 0); assert.ok(stats.host.totalMemoryBytes > 0);
    const atlas = await atlasStats(); assert.equal(atlas.status, "ok");
    assert.ok(!JSON.stringify(atlas).includes(database.getUri()));
    await mongoose.disconnect(); assert.equal((await atlasStats()).status, "unavailable");
    await mongoose.connect(database.getUri());
});
