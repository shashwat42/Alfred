export function isValidCalendarDate(str: unknown): boolean {
    if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return false;
    }
    const [y, m, d] = str.split("-").map(Number);
    if (!y || !m || !d) {
        return false;
    }
    if (m < 1 || m > 12 || d < 1 || d > 31) {
        return false;
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
    );
}

export function normalizeDateInput(raw: unknown): string | null {
    if (typeof raw === "string" && isValidCalendarDate(raw)) {
        return raw;
    }
    if (typeof raw === "string") {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            const formatted = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
            if (isValidCalendarDate(formatted)) {
                return formatted;
            }
        }
    }
    return null;
}
