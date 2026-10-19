import { GoogleAuth } from "google-auth-library";
import { Types } from "mongoose";
import { Account } from "../../models/account.model.ts";
import { NotificationDevice } from "./models.ts";
import { claim, plan } from "./service.ts";
import { GRACE_MS, type Reminder } from "./policy.ts";
import { startPushDispatcher, type PushDevice, type PushDispatchAdapter } from "./pushDispatcher.ts";

export function pushPayload(device: PushDevice, reminder: Reminder, now = Date.now()) {
    return { message: {
        token: device.pushToken,
        android: { priority: "HIGH", ttl: `${Math.max(0, Math.floor((Math.min(reminder.dueAt + GRACE_MS, device.sessionExpiresAt) - now) / 1000))}s` },
        data: Object.fromEntries(Object.entries({ ...reminder, title: reminder.title.slice(0, 160), body: reminder.body.slice(0, 240), accountId: device.accountId, sessionHash: device.sessionHash }).map(([key, value]) => [key, String(value)])),
    } };
}

/** This worker enumerates installation metadata globally; every schedule read and
 * claim then uses the existing tenant-scoped service. No user bearer is retained. */
const activeFilter = (d: PushDevice) => ({
        _id: d.id, accountId: new Types.ObjectId(d.accountId), platform: "mobile" as const, sessionHash: d.sessionHash,
        pushToken: d.pushToken, expiresAt: { $gt: new Date() }, pushSessionExpiresAt: { $gt: new Date() },
    });
export function createPushAdapter(send: PushDispatchAdapter["send"]): PushDispatchAdapter {
    return {
        async devices(cursor) {
            const rows = await NotificationDevice.find({ platform: "mobile", pushToken: { $type: "string" },
                expiresAt: { $gt: new Date() }, pushSessionExpiresAt: { $gt: new Date() },
                ...(cursor ? { _id: { $gt: cursor } } : {}),
            }).select("+pushToken").sort({ _id: 1 }).limit(100).lean();
            return rows.map(d => ({ id: d._id, accountId: String(d.accountId), sessionHash: d.sessionHash,
                sessionVersion: d.pushSessionVersion ?? 0, sessionExpiresAt: d.pushSessionExpiresAt!.getTime(),
                expiresAt: d.expiresAt.getTime(), pushToken: d.pushToken! }));
        },
        async active(d) {
            const [device, account] = await Promise.all([
                NotificationDevice.exists(activeFilter(d)),
                Account.exists({ _id: d.accountId, migratedTo: { $exists: false },
                    ...(d.sessionVersion === 0 ? { $or: [{ sessionVersion: 0 }, { sessionVersion: { $exists: false } }] } : { sessionVersion: d.sessionVersion }) }),
            ]);
            return Boolean(device && account);
        },
        plan: (accountId, now, cursor) => plan(accountId, "mobile", now, cursor),
        claim: (device, key, now) => claim(device.accountId, device.id, "mobile", key, now),
        send,
    };
}

export function startSchedulePush() {
    const project = process.env.FCM_PROJECT_ID?.trim();
    const encoded = process.env.FCM_SERVICE_ACCOUNT_BASE64?.trim();
    if (!project && !encoded) return () => {};
    if (!project || !encoded || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error("Invalid FCM configuration");
    let credentials;
    try {
        credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        if (credentials.type !== "service_account" || credentials.project_id !== project || typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") throw new Error();
    } catch { throw new Error("Invalid FCM service account configuration"); }
    const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
    return startPushDispatcher(createPushAdapter(async (device, reminder) => {
            if (Date.now() > reminder.dueAt + GRACE_MS) return;
            try {
                const client = await auth.getClient();
                await client.request({ url: `https://fcm.googleapis.com/v1/projects/${project}/messages:send`, method: "POST",
                    data: pushPayload(device, reminder), timeout: 8000, retry: false });
            } catch (error) {
                // Remove only the exact invalid token, never a replacement registration.
                const failure = error as { response?: { data?: { error?: { details?: { errorCode?: string }[] } } } };
                if (failure.response?.data?.error?.details?.some(d => d.errorCode === "UNREGISTERED")) {
                    await NotificationDevice.updateOne(activeFilter(device), { $unset: { pushToken: "" } });
                }
                // Never log provider responses: they can contain installation tokens.
                console.error("Schedule push delivery attempt failed");
            }
    }), () => console.error("Schedule push dispatch temporarily unavailable"));
}
