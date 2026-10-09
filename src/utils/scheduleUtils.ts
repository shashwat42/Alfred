export const TIMELINE_HOURS = Array.from({ length: 24 }, (_, i) => i);

export const EVENT_PALETTE = [
    { bg: "rgba(139, 92, 246, 0.22)", border: "#8b5cf6", text: "#ddd6fe" },
    { bg: "rgba(14, 165, 233, 0.22)", border: "#0ea5e9", text: "#bae6fd" },
    { bg: "rgba(16, 185, 129, 0.22)", border: "#10b981", text: "#a7f3d0" },
    { bg: "rgba(245, 158, 11, 0.22)", border: "#f59e0b", text: "#fde68a" },
    { bg: "rgba(244, 63, 94, 0.22)", border: "#f43f5e", text: "#fecdd3" },
];

/** Parses a time string (e.g. "1:30 PM") into total minutes from midnight. */
export function parseTimeToMinutes(timeStr: string): number {
    const clean = timeStr.trim().toLowerCase();
    const isPm = clean.includes("pm");
    const isAm = clean.includes("am");
    const numbers = clean.replace(/[^\d:]/g, "");
    const parts = numbers.split(":");
    let hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;

    if (isPm && hours < 12) hours += 12;
    if (isAm && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

/** Formats the relative time difference into a readable string (e.g. "in 2h 15m"). */
export function getRelativeTimeBadge(itemMinutes: number, currentMinutes: number): string {
    const diff = itemMinutes - currentMinutes;
    if (diff <= 0) return "Now";
    if (diff < 60) return `in ${diff}m`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
}
