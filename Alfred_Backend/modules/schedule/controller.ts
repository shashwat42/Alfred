import type { Request, Response } from 'express'

import { getSchedule } from './service.ts'
export function listSchedule(req: Request, res: Response) {
    res.json(getSchedule());
}