import mongoose, { Schema } from "mongoose";

const settings = new Schema({
    accountId: { type: Schema.Types.ObjectId, required: true, unique: true },
    destination: { type: String, enum: ["mobile", "desktop", "both"], default: "both" },
    enabled: { type: Boolean, default: true }, leadMinutes: { type: Number, default: 10 },
    atStart: { type: Boolean, default: false }, timeZone: { type: String, required: true },
    revision: { type: Number, default: 0 },
    effectiveFrom: { type: Date },
});
const devices = new Schema({
    // Hash of an installation-generated 256-bit capability. Never returned or logged.
    _id: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, required: true, index: true },
    platform: { type: String, enum: ["mobile", "desktop"], required: true },
    sessionHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
});
const deliveries = new Schema({
    _id: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, required: true },
    migrationSourceId: { type: Schema.Types.ObjectId },
    deviceId: { type: String, required: true }, scheduleId: { type: Schema.Types.ObjectId, required: true },
    claimedAt: { type: Date, required: true },
    // Retain beyond the occurrence, not just the short delivery window.
    expiresAt: { type: Date, required: true, expires: 0 },
});
deliveries.index({ accountId: 1, deviceId: 1, scheduleId: 1 });
export const NotificationSettings = mongoose.model("ScheduleNotificationSettings", settings);
export const NotificationDevice = mongoose.model("ScheduleNotificationDevice", devices);
export const NotificationDelivery = mongoose.model("ScheduleNotificationDelivery", deliveries);
