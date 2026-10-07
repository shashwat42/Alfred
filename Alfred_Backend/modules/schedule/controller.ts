import type { Request, Response } from 'express'

import { addSchedule, getSchedule } from './service.ts'

type ScheduleItem = {
    time: string;
    topic: string;
};

export function listSchedule(req: Request, res: Response) {
    res.json(getSchedule());
}

export function createSchedule(
    req: Request<
        Record<string, never>,
        unknown,
        { schedule?: Partial<ScheduleItem> }
    >,
    res: Response
) {
    const { time, topic } = req.body?.schedule ?? {};
    if (
        typeof time !== 'string' ||
        time.trim().length === 0 ||
        typeof topic !== 'string' ||
        topic.trim().length === 0
    ) {
        res.status(400).json({ error: 'Schedule must include a non-empty time and topic' });
        return;
    }

    const schedule = { time: time.trim(), topic: topic.trim() };
    addSchedule(schedule);
    res.status(201).json({ schedule });
}