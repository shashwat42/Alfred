import { getTasks } from "./service.ts";
import type { Response, Request } from 'express';

export function listTasks(req: Request, res: Response) {
    res.json(getTasks());
}
