import "dotenv/config";

export function parseMode(raw: string | undefined, nodeEnv?: string): "development" | "production" {
    if (raw !== undefined && raw !== "development" && raw !== "production") throw new Error("MODE must be development or production");
    return raw ?? (nodeEnv === "development" ? "development" : "production");
}
function limit(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) throw new Error("Quota limits must be positive safe integers");
    return Number(raw);
}
export const policy = {
    enforceQuotas: parseMode(process.env.MODE, process.env.NODE_ENV) !== "development",
    storageBytes: limit(process.env.STORAGE_QUOTA_BYTES, 10_000_000),
    dailyRequests: limit(process.env.AI_DAILY_REQUESTS, 50),
    monthlyRequests: limit(process.env.AI_MONTHLY_REQUESTS, 1000),
};
export function utcWindows(now = new Date()) {
    const year = now.getUTCFullYear(), month = now.getUTCMonth(), day = now.getUTCDate();
    return {
        daily: { key: now.toISOString().slice(0, 10), resetAt: new Date(Date.UTC(year, month, day + 1)).toISOString() },
        monthly: { key: now.toISOString().slice(0, 7), resetAt: new Date(Date.UTC(year, month + 1, 1)).toISOString() },
    };
}
