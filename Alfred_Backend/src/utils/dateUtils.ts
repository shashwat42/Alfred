export function normalizeDateInput(raw: unknown): string | null {
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
    }
    if (typeof raw === "string") {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
        }
    }
    return null;
}
