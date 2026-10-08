import mongoose from "mongoose";
import { Task, type ITask } from "../../models/task.model.ts";

export async function getTasks(accountId: string): Promise<ITask[]> {
    return Task.find({ accountId: new mongoose.Types.ObjectId(accountId) })
        .sort({ createdAt: -1 })
        .lean();
}

export async function addTask(accountId: string, taskText: string): Promise<ITask> {
    const task = await Task.create({
        accountId: new mongoose.Types.ObjectId(accountId),
        task: taskText,
        completed: false,
    });
    return task.toObject();
}

export async function updateTask(
    accountId: string,
    taskId: string,
    updates: { task?: string; completed?: boolean }
): Promise<ITask | null> {
    if (!mongoose.isValidObjectId(taskId)) {
        return null;
    }

    const updateData: { task?: string; completed?: boolean } = {};
    if (typeof updates.task === "string" && updates.task.trim().length > 0) {
        updateData.task = updates.task.trim();
    }
    if (typeof updates.completed === "boolean") {
        updateData.completed = updates.completed;
    }

    return Task.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(taskId),
            accountId: new mongoose.Types.ObjectId(accountId),
        },
        { $set: updateData },
        { returnDocument: "after" }
    ).lean();
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
        return Task.findOneAndUpdate(
            {
                _id: new mongoose.Types.ObjectId(taskId),
                accountId: new mongoose.Types.ObjectId(accountId),
            },
            { $set: { completed } },
            { returnDocument: "after" }
        ).lean();
    }

    const existing = await Task.findOne({
        _id: new mongoose.Types.ObjectId(taskId),
        accountId: new mongoose.Types.ObjectId(accountId),
    });
    if (!existing) return null;

    existing.completed = !existing.completed;
    await existing.save();
    return existing.toObject();
}

export async function clearAllTasks(accountId: string): Promise<{ deletedCount: number }> {
    const result = await Task.deleteMany({
        accountId: new mongoose.Types.ObjectId(accountId),
    });
    return { deletedCount: result.deletedCount };
}

export async function deleteTask(accountId: string, taskId: string): Promise<ITask | null> {
    if (!mongoose.isValidObjectId(taskId)) {
        return null;
    }

    return Task.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(taskId),
        accountId: new mongoose.Types.ObjectId(accountId),
    }).lean();
}