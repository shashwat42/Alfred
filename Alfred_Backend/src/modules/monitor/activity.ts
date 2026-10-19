import type { Request, Response, NextFunction } from "express";

/** Fixed bounds, no timers, no durable user tracking or request contents. */
export class Activity {
    private users = new Map<string, number>();
    private buckets = new Map<number, { requests: number; errors: number; milliseconds: number }>();
    private active = new Map<string, number>();
    inFlight = 0;
    touch(id: string, now = Date.now()) {
        this.users.delete(id); this.users.set(id, now);
        for (const [key, seen] of this.users) {
            if (now - seen <= 300_000 && this.users.size <= 10_000) break;
            this.users.delete(key);
        }
    }
    authenticated(id: string, res: Response) {
        this.touch(id);
        this.active.set(id, (this.active.get(id) ?? 0) + 1);
        let done = false;
        const end = () => {
            if (done) return; done = true;
            const remaining = (this.active.get(id) ?? 1) - 1;
            if (remaining) this.active.set(id, remaining); else this.active.delete(id);
        };
        res.once("finish", end); res.once("close", end);
    }
    record(status: number, milliseconds: number, now = Date.now()) {
        const minute = Math.floor(now / 60_000);
        const bucket = this.buckets.get(minute) ?? { requests: 0, errors: 0, milliseconds: 0 };
        bucket.requests++; bucket.errors += Number(status >= 500); bucket.milliseconds += milliseconds;
        this.buckets.set(minute, bucket);
        for (const key of this.buckets.keys()) if (key < minute - 1) this.buckets.delete(key);
    }
    snapshot(now = Date.now()) {
        for (const [id, seen] of this.users) if (now - seen > 300_000) this.users.delete(id);
        const bucket = this.buckets.get(Math.floor(now / 60_000) - 1);
        return { activeAccounts5m: this.users.size, accountsMakingRequests: this.active.size,
            inFlight: this.inFlight, previousMinute: { requests: bucket?.requests ?? 0, errors: bucket?.errors ?? 0,
                averageLatencyMs: bucket?.requests ? Math.round(bucket.milliseconds / bucket.requests) : null } };
    }
}
export const activity = new Activity();
export function requestMetrics(req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith("/api/") && !req.path.startsWith("/auth/")) { next(); return; }
    activity.inFlight++;
    const started = performance.now(); let done = false;
    const finish = () => {
        if (done) return; done = true;
        activity.inFlight--; activity.record(res.writableFinished ? res.statusCode : 499, performance.now() - started);
    };
    res.once("finish", finish); res.once("close", finish); next();
}

type ServiceName = "ai" | "google" | "firebase";
const observations = new Map<ServiceName, { ok: boolean; at: string; latencyMs: number }>();
export function observeService(name: ServiceName, ok: boolean, started: number) {
    observations.set(name, { ok, at: new Date().toISOString(), latencyMs: Date.now() - started });
}
export function serviceObservation(name: ServiceName) { return observations.get(name) ?? null; }
export async function trackedAiFetch(input: string, init: RequestInit) {
    const started = Date.now();
    try { const result = await fetch(input, init); observeService("ai", result.ok, started); return result; }
    catch (error) { observeService("ai", false, started); throw error; }
}
