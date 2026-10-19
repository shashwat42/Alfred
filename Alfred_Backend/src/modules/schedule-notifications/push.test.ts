process.env.MODE = "development";
import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchPushPass, type PushDevice, type PushDispatchAdapter } from "./pushDispatcher.ts";
import type { Reminder } from "./policy.ts";
import { pushPayload } from "./pushService.ts";

const now = Date.parse("2026-10-19T10:00:00Z");
const reminder: Reminder = { key: "event:lead", scheduleId: "event", date: "2026-10-19", title: "Call", body: "10:10", kind: "lead", eventAt: now + 600_000, dueAt: now };
const device: PushDevice = { id: "installation", accountId: "account", sessionHash: "session", sessionVersion: 0, expiresAt: now + 100000, sessionExpiresAt: now + 100000, pushToken: "isolated-device-token" };
test("FCM carries bounded data-only reminders with no bearer credential and short expiry", () => {
    const payload = pushPayload(device, { ...reminder, title: "x".repeat(10000) }, now);
    assert.equal(payload.message.android.priority, "HIGH");
    assert.equal(payload.message.android.ttl, "100s");
    assert.equal(payload.message.data.title!.length, 160);
    assert.equal(payload.message.data.sessionHash, device.sessionHash);
    assert.equal("notification" in payload.message, false);
    assert.equal("secret" in payload.message.data, false);
    assert.equal(pushPayload(device, reminder, now + 200000).message.android.ttl, "0s");
});
function fixture() {
    const sent: string[] = [], claims = new Set<string>();
    let devices = [device];
    const adapter: PushDispatchAdapter = {
        devices: async cursor => cursor ? [] : devices,
        active: async () => true,
        plan: async () => ({ reminders: [reminder], next: null }),
        claim: async (d, key) => { const id = `${d.id}:${key}`; if (claims.has(id)) return null; claims.add(id); return reminder; },
        send: async d => { sent.push(d.id); },
    };
    return { adapter, sent, claims, devices: (value: PushDevice[]) => { devices = value; } };
}

test("server dispatch sends a due reminder without any foreground client and shares native-alarm claims", async () => {
    const f = fixture();
    await dispatchPushPass(f.adapter, now);
    await dispatchPushPass(f.adapter, now + 1000);
    assert.deepEqual(f.sent, [device.id]);
    const native = fixture(); native.claims.add(`${device.id}:${reminder.key}`);
    await dispatchPushPass(native.adapter, now);
    assert.equal(native.sent.length, 0);
});

test("different installations receive independently; expired sessions and revoked registrations do not", async () => {
    const f = fixture();
    f.devices([device, { ...device, id: "phone-2" }, { ...device, id: "expired", sessionExpiresAt: now }]);
    await dispatchPushPass(f.adapter, now);
    assert.deepEqual(f.sent, [device.id, "phone-2"]);
    f.adapter.active = async () => false;
    f.claims.clear(); f.sent.length = 0;
    await dispatchPushPass(f.adapter, now);
    assert.equal(f.sent.length, 0);
});

test("logout racing a claim prevents the outgoing push", async () => {
    const f = fixture(); let checks = 0;
    f.adapter.active = async () => ++checks === 1;
    await dispatchPushPass(f.adapter, now);
    assert.equal(f.claims.size, 1); assert.equal(f.sent.length, 0);
});

test("future and stale reminders do not produce push; shutdown interrupts the pass", async () => {
    const f = fixture();
    f.adapter.plan = async () => ({ reminders: [{ ...reminder, dueAt: now + 1000 }, { ...reminder, dueAt: now - 120001 }], next: null });
    await dispatchPushPass(f.adapter, now);
    assert.equal(f.sent.length, 0);
    await dispatchPushPass(f.adapter, now, () => true);
    assert.equal(f.claims.size, 0);
});
