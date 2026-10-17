import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { Schedule } from "../../models/schedule.model.ts";
import { NotificationSettings, NotificationDevice, NotificationDelivery } from "./models.ts";
import { claim, initializeNotificationIndexes, plan } from "./service.ts";

const uri = process.env.ALFRED_NOTIFICATION_TEST_MONGODB_URI;
test("real MongoDB: concurrent delivery uniqueness, restart reconstruction and account isolation", { skip: !uri && "Set ALFRED_NOTIFICATION_TEST_MONGODB_URI to an isolated *_test database" }, async () => {
    // Never run destructive test cleanup against an application database.
    const parsed = new URL(uri!);
    assert.match(parsed.pathname, /\/[a-zA-Z0-9_-]*_test$/);
    await mongoose.connect(uri!);
    const account = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const instant = Date.parse("2026-10-17T09:50Z");
    try {
        await initializeNotificationIndexes();
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
    } finally {
        await Promise.all([Schedule.deleteMany({ accountId: account }), NotificationSettings.deleteMany({ accountId: account }), NotificationDevice.deleteMany({ accountId: account }), NotificationDelivery.deleteMany({ accountId: account })]);
        await mongoose.disconnect();
    }
});
