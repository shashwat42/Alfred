import type { Request, Response } from "express";
import {
    addSchedule,
    deleteSchedule as removeSchedule,
    getSchedule,
    updateSchedule as editSchedule,
} from "./service.ts";

export type ScheduleItem = {
    time: string;
    topic: string;
    date: string;
};

export async function listSchedule(req: Request, res: Response): Promise<void> {
    try {
        const accountId = req.accountId;
        if (!accountId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
            ? req.query.date
            : today;

        const schedule = await getSchedule(accountId, date);
        res.json(schedule);
    } catch (err) {
        console.error("Error listing schedule:", err);
        res.status(500).json({ error: "Failed to retrieve schedule" });
    }
}

export async function createSchedule(
    req: Request<
        Record<string, never>,
        unknown,
        { schedule?: Partial<ScheduleItem>; accountId?: unknown }
    >,
    res: Response
): Promise<void> {
    try {
        const accountId = req.accountId;
        if (!accountId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const payload = (req.body?.schedule ?? req.body ?? {}) as Partial<ScheduleItem>;
        const time = payload.time;
        const topic = payload.topic;
        let date = payload.date;

        if (
            typeof time !== "string" ||
            time.trim().length === 0 ||
            typeof topic !== "string" ||
            topic.trim().length === 0
        ) {
            res.status(400).json({ error: "Schedule must include a non-empty time and topic" });
            return;
        }

        if (typeof date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const parsed = new Date(date);
            if (!Number.isNaN(parsed.getTime())) {
                date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
            }
        }

        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.status(400).json({ error: "Schedule must include a valid date (YYYY-MM-DD)" });
            return;
        }

        const created = await addSchedule(accountId, {
            time: time.trim(),
            topic: topic.trim(),
            date,
        });

        res.status(201).json({ schedule: created });
    } catch (err) {
        console.error("Error creating schedule:", err);
        res.status(500).json({ error: "Failed to create schedule item" });
    }
}

export async function updateSchedule(
    req: Request<
        { id: string },
        unknown,
        { schedule?: Partial<ScheduleItem>; accountId?: unknown }
    >,
    res: Response
): Promise<void> {
    try {
        const accountId = req.accountId;
        if (!accountId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const { id } = req.params;
        const { time, topic, date } = req.body?.schedule ?? {};

        const updates: { time?: string; topic?: string; date?: string } = {};
        if (time !== undefined) {
            if (typeof time !== "string" || time.trim().length === 0) {
                res.status(400).json({ error: "Time must be a non-empty string" });
                return;
            }
            updates.time = time.trim();
        }

        if (topic !== undefined) {
            if (typeof topic !== "string" || topic.trim().length === 0) {
                res.status(400).json({ error: "Topic must be a non-empty string" });
                return;
            }
            updates.topic = topic.trim();
        }

        if (date !== undefined) {
            if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                res.status(400).json({ error: "Date must match YYYY-MM-DD" });
                return;
            }
            updates.date = date;
        }

        if (updates.time === undefined && updates.topic === undefined && updates.date === undefined) {
            res.status(400).json({ error: "No valid update fields provided" });
            return;
        }

        const updated = await editSchedule(accountId, id, updates);
        if (!updated) {
            res.status(404).json({ error: "Schedule item not found" });
            return;
        }

        res.json({ schedule: updated });
    } catch (err) {
        console.error("Error updating schedule:", err);
        res.status(500).json({ error: "Failed to update schedule item" });
    }
}

export async function deleteSchedule(
    req: Request<{ id: string }>,
    res: Response
): Promise<void> {
    try {
        const accountId = req.accountId;
        if (!accountId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const { id } = req.params;
        const deleted = await removeSchedule(accountId, id);
        if (!deleted) {
            res.status(404).json({ error: "Schedule item not found" });
            return;
        }

        res.json({ message: "Schedule item deleted successfully", id });
    } catch (err) {
        console.error("Error deleting schedule:", err);
        res.status(500).json({ error: "Failed to delete schedule item" });
    }
}
