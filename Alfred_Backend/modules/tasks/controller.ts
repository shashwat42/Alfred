import { addTask, getTasks } from "./service.ts";
import type { Response, Request } from 'express';

export function listTasks(req: Request, res: Response) {
    res.json(getTasks());
}

export function createTask(
    req: Request<Record<string, never>, unknown, { task?: unknown }>,
    res: Response,
) {
    const task = req.body?.task;
    if (typeof task !== "string" || task.trim().length === 0) {
        res.status(400).json({ error: "Task must be a non-empty string" });
        return;
    }

    res.status(201).json({ task: addTask(task.trim()) });
}