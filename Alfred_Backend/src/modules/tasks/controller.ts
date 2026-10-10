import type { Request, Response } from "express";
import { requireAccountId } from "../../utils/requireAccountId.ts";
import {
    addTask,
    clearAllTasks as removeAllTasks,
    completeTask as markTaskCompletion,
    deleteTask as removeTask,
    getTasks,
    updateTask as editTask,
} from "./service.ts";

export async function listTasks(req: Request, res: Response): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const tasks = await getTasks(accountId);
        res.json(tasks);
    } catch (err) {
        console.error("Error listing tasks:", err);
        res.status(500).json({ error: "Failed to retrieve tasks" });
    }
}

import type { TaskPriority } from "../../models/task.model.ts";

export async function createTask(
    req: Request<Record<string, never>, unknown, { task?: unknown; priority?: unknown }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const taskText = req.body?.task;
        if (typeof taskText !== "string" || taskText.trim().length === 0) {
            res.status(400).json({ error: "Task must be a non-empty string" });
            return;
        }

        const validPriorities = ["urgent", "high", "medium", "normal", "low"];
        const rawPriority = req.body?.priority;
        const priority: TaskPriority =
            typeof rawPriority === "string" && validPriorities.includes(rawPriority)
                ? (rawPriority as TaskPriority)
                : "normal";

        const createdTask = await addTask(accountId, taskText.trim(), priority);
        res.status(201).json(createdTask);
    } catch (err) {
        console.error("Error creating task:", err);
        res.status(500).json({ error: "Failed to create task" });
    }
}

export async function updateTask(
    req: Request<{ id: string }, unknown, { task?: unknown; completed?: unknown; priority?: unknown }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const { id } = req.params;
        const { task, completed, priority } = req.body ?? {};

        const updates: { task?: string; completed?: boolean; priority?: TaskPriority } = {};
        if (task !== undefined) {
            if (typeof task !== "string" || task.trim().length === 0) {
                res.status(400).json({ error: "Task must be a non-empty string" });
                return;
            }
            updates.task = task.trim();
        }

        if (completed !== undefined) {
            if (typeof completed !== "boolean") {
                res.status(400).json({ error: "Completed must be a boolean" });
                return;
            }
            updates.completed = completed;
        }

        if (priority !== undefined) {
            const validPriorities = ["urgent", "high", "medium", "normal", "low"];
            if (typeof priority !== "string" || !validPriorities.includes(priority)) {
                res.status(400).json({ error: "Invalid priority value" });
                return;
            }
            updates.priority = priority as TaskPriority;
        }

        if (updates.task === undefined && updates.completed === undefined && updates.priority === undefined) {
            res.status(400).json({ error: "No valid update fields provided" });
            return;
        }

        const updated = await editTask(accountId, id, updates);
        if (!updated) {
            res.status(404).json({ error: "Task not found" });
            return;
        }

        res.json(updated);
    } catch (err) {
        console.error("Error updating task:", err);
        res.status(500).json({ error: "Failed to update task" });
    }
}

export async function completeTask(
    req: Request<{ id: string }, unknown, { completed?: unknown }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const { id } = req.params;
        const { completed } = req.body ?? {};

        if (completed !== undefined && typeof completed !== "boolean") {
            res.status(400).json({ error: "Completed must be a boolean if provided" });
            return;
        }

        const updated = await markTaskCompletion(accountId, id, completed);
        if (!updated) {
            res.status(404).json({ error: "Task not found" });
            return;
        }

        res.json(updated);
    } catch (err) {
        console.error("Error completing task:", err);
        res.status(500).json({ error: "Failed to mark task complete" });
    }
}

export async function clearAllTasks(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const result = await removeAllTasks(accountId);
        res.json({
            message: "All tasks cleared successfully",
            deletedCount: result.deletedCount,
        });
    } catch (err) {
        console.error("Error clearing tasks:", err);
        res.status(500).json({ error: "Failed to clear all tasks" });
    }
}

export async function deleteTask(
    req: Request<{ id: string }>,
    res: Response
): Promise<void> {
    try {
        const accountId = requireAccountId(req, res);
        if (!accountId) return;

        const { id } = req.params;
        const deleted = await removeTask(accountId, id);
        if (!deleted) {
            res.status(404).json({ error: "Task not found" });
            return;
        }

        res.json({ message: "Task deleted successfully", id });
    } catch (err) {
        console.error("Error deleting task:", err);
        res.status(500).json({ error: "Failed to delete task" });
    }
}