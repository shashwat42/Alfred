import { isDue, type Reminder } from "./policy.ts";

export interface PushDevice {
    id: string;
    accountId: string;
    sessionHash: string;
    sessionVersion: number;
    expiresAt: number;
    sessionExpiresAt: number;
    pushToken: string;
}

export interface PushDispatchAdapter {
    devices(cursor?: string): Promise<PushDevice[]>;
    active(device: PushDevice): Promise<boolean>;
    plan(accountId: string, now: number, cursor?: string): Promise<{ reminders: Reminder[]; next: string | null }>;
    claim(device: PushDevice, key: string, now: number): Promise<Reminder | null>;
    send(device: PushDevice, reminder: Reminder): Promise<void>;
}

/** A bounded server pass discovers due mobile reminders even when no app is open.
 * Claiming shares the existing ledger with native alarms, so the two transports
 * cannot independently deliver the same occurrence to the same installation. */
export async function dispatchPushPass(adapter: PushDispatchAdapter, now = Date.now(), stopped = () => false) {
    let cursor: string | undefined;
    for (let devicePage = 0; devicePage < 20 && !stopped(); devicePage++) {
        const devices = await adapter.devices(cursor);
        if (!devices.length) return;
        for (const device of devices) {
            if (stopped()) return;
            if (device.expiresAt <= now || device.sessionExpiresAt <= now || !await adapter.active(device)) continue;
            let next: string | undefined;
            for (let page = 0; page < 50 && !stopped(); page++) {
                const plan = await adapter.plan(device.accountId, now, next);
                for (const reminder of plan.reminders) {
                    if (stopped()) return;
                    if (!isDue(reminder, now)) continue;
                    const claimed = await adapter.claim(device, reminder.key, now);
                    // A logout, account migration or token rotation may race a claim.
                    if (claimed && !stopped() && await adapter.active(device)) await adapter.send(device, claimed);
                }
                if (!plan.next) break;
                next = plan.next;
            }
        }
        cursor = devices.at(-1)!.id;
    }
}

export function startPushDispatcher(adapter: PushDispatchAdapter, onError: () => void, intervalMs = 15_000) {
    let stopped = false, busy = false;
    const tick = async () => {
        if (stopped || busy) return;
        busy = true;
        try { await dispatchPushPass(adapter, Date.now(), () => stopped); }
        catch { if (!stopped) onError(); }
        finally { busy = false; }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref();
    return () => { stopped = true; clearInterval(timer); };
}
