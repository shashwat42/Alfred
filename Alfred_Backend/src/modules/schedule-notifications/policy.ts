import { isValidCalendarDate } from "../../utils/dateUtils.ts";

export interface Preferences {
    destination: "mobile" | "desktop" | "both";
    enabled: boolean;
    leadMinutes: number;
    atStart: boolean;
    timeZone: string;
    timeZoneMode?: "automatic" | "manual" | undefined;
    revision: number;
    effectiveFrom?: number;
}
export const defaultPreferences = (): Preferences => ({
    destination: "both", enabled: true, leadMinutes: 10, atStart: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", timeZoneMode: "automatic", revision: 0,
});
export type Platform = "mobile" | "desktop";
export interface Reminder {
    key: string; scheduleId: string; date: string; title: string; body: string;
    kind: "lead" | "start"; eventAt: number; dueAt: number;
}
export const GRACE_MS = 120_000;
export const HORIZON_MS = 48 * 60 * 60_000;
export function eligible(p: Preferences, platform: Platform): boolean {
    return p.enabled && (p.destination === "both" || p.destination === platform);
}

/** Existing dates/times are wall-clock values in the backend's system zone.
 * An explicit account zone preserves this convention across backend restarts.
 * Reject DST gaps; choose the first instant of a repeated wall time. */
export function eventInstant(date: string, time: string, zone: string): number | null {
    if (!isValidCalendarDate(date)) return null;
    const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(time.trim());
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
    if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
    const [year, month, day] = date.split("-").map(Number);
    const wall = Date.UTC(year!, month! - 1, day!, hour, minute);
    try {
        const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
        const parts = (instant: number) => Object.fromEntries(fmt.formatToParts(instant).map(p => [p.type, p.value]));
        const candidates = new Set<number>();
        for (const delta of [-36, 0, 36]) {
            const sample = wall + delta * 3_600_000;
            const p = parts(sample);
            const offset = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - sample;
            const instant = wall - offset;
            const actual = parts(instant);
            if (`${actual.year}-${actual.month}-${actual.day}` === date && +actual.hour! === hour && +actual.minute! === minute) candidates.add(instant);
        }
        return candidates.size ? Math.min(...candidates) : null;
    } catch { return null; }
}

export function remindersFor(schedule: { _id: unknown; date: string; time: string; topic: string }, p: Preferences): Reminder[] {
    if (!p.enabled) return [];
    const eventAt = eventInstant(schedule.date, schedule.time, p.timeZone);
    if (eventAt === null) return [];
    const scheduleId = String(schedule._id);
    const kinds: Array<"lead" | "start"> = p.atStart ? ["lead", "start"] : ["lead"];
    // Zero lead time is a single start notification, even when atStart is enabled.
    return kinds.filter(kind => !(kind === "start" && p.leadMinutes === 0)).map(kind => ({
        key: `${scheduleId}:${eventAt}:${kind}`, scheduleId, date: schedule.date,
        title: schedule.topic, body: `${schedule.date} at ${schedule.time} (${p.timeZone})`,
        kind, eventAt, dueAt: eventAt - (kind === "lead" ? p.leadMinutes * 60_000 : 0),
    })).filter(r => p.effectiveFrom === undefined || r.dueAt >= p.effectiveFrom);
}
export function isDue(r: Reminder, now: number): boolean {
    return r.dueAt <= now && now - r.dueAt <= GRACE_MS && now <= r.eventAt + (r.kind === "start" || r.dueAt === r.eventAt ? GRACE_MS : 0);
}
