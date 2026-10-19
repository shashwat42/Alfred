import os from "node:os";
import { readFile, statfs } from "node:fs/promises";
import mongoose from "mongoose";
import { env } from "../../config/env.ts";
import { databaseReady } from "../../config/database.ts";
import { activity, serviceObservation } from "./activity.ts";

/** One cached object and one shared in-flight collection; no sampler/timer. */
export class OnDemandSnapshot<T> {
    private cached: { at: number; value: T } | undefined;
    private pending: Promise<T> | undefined;
    private collect: () => Promise<T>;
    private ttl: number;
    constructor(collect: () => Promise<T>, ttl = 30_000) { this.collect = collect; this.ttl = ttl; }
    get(now = Date.now()): Promise<T> {
        if (this.cached && now - this.cached.at < this.ttl) return Promise.resolve(this.cached.value);
        if (!this.pending) {
            this.pending = this.collect().then(value => { this.cached = { at: Date.now(), value }; return value; })
                .finally(() => { this.pending = undefined; });
        }
        return this.pending;
    }
}
async function numericFile(path: string) {
    try { const value = Number((await readFile(path, "utf8")).trim()); return Number.isFinite(value) ? value : null; }
    catch { return null; }
}
export async function resources() {
    const memory = process.memoryUsage();
    const [current, limit, disk] = await Promise.all([
        numericFile("/sys/fs/cgroup/memory.current"), numericFile("/sys/fs/cgroup/memory.max"),
        statfs(process.cwd()).then(s => ({ totalBytes: s.blocks * s.bsize,
            usedBytes: (s.blocks - s.bfree) * s.bsize, availableBytes: s.bavail * s.bsize })).catch(() => null),
    ]);
    return { process: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal,
        cpuSeconds: (process.cpuUsage().user + process.cpuUsage().system) / 1_000_000, uptimeSeconds: process.uptime() },
        host: { totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), loadAverage: os.loadavg(),
            logicalCpus: os.cpus().length, uptimeSeconds: os.uptime() },
        container: { memoryBytes: current, memoryLimitBytes: limit },
        filesystem: disk };
}
export async function atlasStats() {
    const db = mongoose.connection.db;
    if (!db || mongoose.connection.readyState !== 1) return { status: "unavailable" as const };
    const started = Date.now();
    try {
        const stats = await db.command({ dbStats: 1, scale: 1, freeStorage: 0, maxTimeMS: 3000 }, { timeoutMS: 4000 });
        const numeric = (key: string) => typeof stats[key] === "number" && Number.isFinite(stats[key]) ? stats[key] as number : null;
        return { status: "ok" as const, latencyMs: Date.now() - started, dataBytes: numeric("dataSize"),
            storageBytes: numeric("storageSize"), indexBytes: numeric("indexSize"), collections: numeric("collections"),
            // dbStats describes this database, not Atlas cluster-wide billing usage.
            limitBytes: null, scope: "Application database only; Atlas cluster limit is not configured." };
    } catch { return { status: "unavailable" as const, detail: "Statistics unavailable or database user lacks permission." }; }
}
async function probe(url: string) {
    const started = Date.now();
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "error",
            headers: { "User-Agent": "Alfred-Monitor", Accept: "application/json" } });
        await response.body?.cancel();
        return { status: response.ok ? "reachable" : "degraded", httpStatus: response.status, latencyMs: Date.now() - started };
    } catch { return { status: "unreachable", latencyMs: Date.now() - started }; }
}
export function createMetrics(isDraining: () => boolean) {
    return new OnDemandSnapshot(async () => {
        const [server, ready, atlas, google, github] = await Promise.all([
            resources(), databaseReady(), atlasStats(),
            probe("https://accounts.google.com/.well-known/openid-configuration"),
            probe("https://api.github.com/repos/shashwat42/Alfred/releases?per_page=1"),
        ]);
        return { sampledAt: new Date().toISOString(), mode: env.mode,
            backend: { status: ready && !isDraining() ? "healthy" : "unavailable", draining: isDraining(),
                revision: /^[a-f0-9]{40}$/.test(process.env.ALFRED_REVISION ?? "") ? process.env.ALFRED_REVISION : "development / unknown" },
            server, traffic: activity.snapshot(), atlas,
            services: {
                google: { ...google, detail: "Google discovery reachability; does not validate OAuth credentials.", lastRequest: serviceObservation("google") },
                github: { ...github, detail: "Public release API reachability; does not test individual downloads." },
                ai: { status: env.llm.apiKey ? "configured" : "not configured", provider: new URL(env.llm.baseUrl).hostname,
                    model: env.llm.model, lastRequest: serviceObservation("ai"), detail: "Latest real request; no monitoring requests use AI credits." },
                firebase: { status: process.env.FCM_PROJECT_ID && process.env.FCM_SERVICE_ACCOUNT_BASE64 ? "configured" : "not configured",
                    lastRequest: serviceObservation("firebase"), detail: "Latest real push delivery; no test notifications are sent." },
            } };
    });
}
