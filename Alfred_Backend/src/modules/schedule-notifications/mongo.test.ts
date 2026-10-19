process.env.MODE = "development";
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Account } from "../../models/account.model.ts";
import { Schedule } from "../../models/schedule.model.ts";
import { NotificationSettings, NotificationDevice, NotificationDelivery } from "./models.ts";
import { claim, initializeNotificationIndexes, plan, registerDevice } from "./service.ts";
import { createPushAdapter } from "./pushService.ts";
import { dispatchPushPass } from "./pushDispatcher.ts";
import { requireTransactionTopology } from "../../security/indexes.ts";

const uri = process.env.ALFRED_NOTIFICATION_TEST_MONGODB_URI;
test("real MongoDB: concurrent delivery uniqueness, restart reconstruction and account isolation", { timeout: 180_000 }, async () => {
    // Never run destructive test cleanup against an application database.
    const temporary = uri ? null : await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const testUri = uri ?? temporary!.getUri("alfred_notifications_test");
    const parsed = new URL(testUri);
    assert.match(parsed.pathname, /\/[a-zA-Z0-9_-]*_test$/);
    await mongoose.connect(testUri);
    const account = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const instant = Date.parse("2026-10-17T09:50Z");
    try {
        await requireTransactionTopology();
        await initializeNotificationIndexes();
        await Account.create({ _id: account, type: "user", googleId: `test-${account}` });
        await NotificationSettings.create({ accountId: account, destination: "both", enabled: true, leadMinutes: 10, timeZone: "UTC", atStart: false, revision: 1 });
        const schedule = await Schedule.create({ accountId: account, topic: "Isolated test event", date: "2026-10-17", time: "10:00" });
        const first = await plan(String(account), "desktop", instant);
        assert.equal(first.reminders.length, 1);
        const key = first.reminders[0]!.key;
        const attempts = await Promise.all(Array.from({ length: 20 }, () => claim(String(account), "test-device", "desktop", key, instant)));
        assert.equal(attempts.filter(Boolean).length, 1);
        assert.equal(await claim(String(account), "test-device", "desktop", key, instant), null);
        assert.equal(await claim(String(other), "test-device", "desktop", key, instant), null);
        assert.equal((await plan(String(other), "desktop", instant)).reminders.length, 0);
        await Schedule.updateOne({ _id: schedule._id }, { $set: { time: "11:00" } });
        assert.equal(await claim(String(account), "new-device", "desktop", key, instant), null);
        assert.equal((await plan(String(account), "desktop", instant)).reminders[0]!.dueAt, instant + 3600_000);
        await Schedule.deleteOne({ _id: schedule._id });
        assert.equal((await plan(String(account), "desktop", instant)).reminders.length, 0);

        // Real registration + indexed worker query + tenant plan + unique claim;
        // only the external delivery is stubbed. No foreground client exists.
        const pushNow = Date.now();
        const start = new Date(Math.ceil((pushNow + 600000) / 60000) * 60000);
        const due = start.getTime() - 600000;
        const pushEvent = await Schedule.create({ accountId: account, topic: "Closed app reminder", date: start.toISOString().slice(0, 10), time: start.toISOString().slice(11, 16) });
        const token = jwt.sign({ sub: String(account), version: 0, exp: Math.floor(pushNow / 1000) + 3600 }, "isolated-test-key");
        await registerDevice(String(account), "a".repeat(64), "mobile", token, pushNow, "isolated-real-db-push-token");
        const sends: string[] = [];
        const adapter = createPushAdapter(async (_device, reminder) => { sends.push(reminder.scheduleId); });
        await dispatchPushPass(adapter, due);
        await dispatchPushPass(adapter, due + 1000);
        assert.deepEqual(sends, [String(pushEvent._id)]);
        const devices = await adapter.devices();
        assert.equal(devices.length, 1);
        assert.equal(await adapter.active(devices[0]!), true);
        await Account.updateOne({ _id: account }, { $inc: { sessionVersion: 1 } });
        assert.equal(await adapter.active(devices[0]!), false);
        // Desktop registration cannot retain a stale phone push token.
        await registerDevice(String(account), "a".repeat(64), "desktop", token, pushNow);
        assert.equal((await adapter.devices()).length, 0);
    } finally {
        await Promise.all([Schedule.deleteMany({ accountId: account }), NotificationSettings.deleteMany({ accountId: account }), NotificationDevice.deleteMany({ accountId: account }), NotificationDelivery.deleteMany({ accountId: account })]);
        await Account.deleteOne({ _id: account });
        await mongoose.disconnect();
        await temporary?.stop();
    }
});
