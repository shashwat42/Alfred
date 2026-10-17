import { tenantRepository } from "../../security/tenantRepository.ts";
import mongoose from "mongoose";
import { Task, type ITask } from "../../models/task.model.ts";

export async function getTasks(accountId: string): Promise<ITask[]> {
    return tenantRepository(Task, accountId).find({}, { sort: { createdAt: -1 } });
}

import type { TaskPriority } from "../../models/task.model.ts";

export async function addTask(
    accountId: string,
    taskText: string,
    priority: TaskPriority = "normal"
): Promise<ITask> {
    const task = await tenantRepository(Task, accountId).create({
        task: taskText,
        completed: false,
        priority,
    });
    return task.toObject();
}

export async function updateTask(
    accountId: string,
    taskId: string,
    updates: { task?: string; completed?: boolean; priority?: TaskPriority }
): Promise<ITask | null> {
    if (!mongoose.isValidObjectId(taskId)) {
        return null;
    }

    const updateData: { task?: string; completed?: boolean; priority?: TaskPriority } = {};
    if (typeof updates.task === "string" && updates.task.trim().length > 0) {
        updateData.task = updates.task.trim();
    }
    if (typeof updates.completed === "boolean") {
        updateData.completed = updates.completed;
    }
    if (updates.priority) {
        updateData.priority = updates.priority;
    }

    return tenantRepository(Task, accountId).findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(taskId),
        },
        updateData
    );
}

export async function completeTask(
    accountId: string,
    taskId: string,
    completed?: boolean
): Promise<ITask | null> {
    if (!mongoose.isValidObjectId(taskId)) {
        return null;
    }

    if (completed !== undefined) {
        return tenantRepository(Task, accountId).findOneAndUpdate(
            {
                _id: new mongoose.Types.ObjectId(taskId),
            },
            { completed }
        );
    }

    return tenantRepository(Task, accountId).toggleCompleted(new mongoose.Types.ObjectId(taskId));
}

export async function clearAllTasks(accountId: string): Promise<{ deletedCount: number }> {
    const result = await tenantRepository(Task, accountId).deleteMany();
    return { deletedCount: result.deletedCount };
}

export async function deleteTask(accountId: string, taskId: string): Promise<ITask | null> {
    if (!mongoose.isValidObjectId(taskId)) {
        return null;
    }

    return tenantRepository(Task, accountId).findOneAndDelete({
        _id: new mongoose.Types.ObjectId(taskId),
    });
}
