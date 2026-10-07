import type { Request, Response } from 'express'

import { addSchedule, getSchedule } from './service.ts'

type ScheduleItem = {
    time: string;
    topic: string;
};

export function listSchedule(req: Request, res: Response) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const date = typeof req.query.date === 'string' ? req.query.date : today;
    res.json(getSchedule(date));
}

export function createSchedule(
    req: Request<
        Record<string, never>,
        unknown,
        { schedule?: Partial<ScheduleItem> }
    >,
    res: Response
) {
    const { time, topic, date } = req.body?.schedule ?? {};
    if (
        typeof time !== 'string' ||
        time.trim().length === 0 ||
        typeof topic !== 'string' ||
        topic.trim().length === 0
    ) {
        res.status(400).json({ error: 'Schedule must include a non-empty time and topic' });
        return;
    }

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: 'Schedule must include a valid date' });
        return;
    }
    const schedule = { time: time.trim(), topic: topic.trim(), date };
    addSchedule(schedule);
    res.status(201).json({ schedule });
}
