import mongoose from "mongoose";
import { Schedule, type ISchedule } from "../../models/schedule.model.ts";

export type ScheduleItem = {
    _id?: string;
    time: string;
    topic: string;
    date: string;
};

export async function getSchedule(accountId: string, date: string): Promise<ISchedule[]> {
    return Schedule.find({
        accountId: new mongoose.Types.ObjectId(accountId),
        date,
    })
        .sort({ time: 1 })
        .lean();
}

export async function addSchedule(
    accountId: string,
    item: { time: string; topic: string; date: string }
): Promise<ISchedule> {
    const doc = await Schedule.create({
        accountId: new mongoose.Types.ObjectId(accountId),
        time: item.time,
        topic: item.topic,
        date: item.date,
    });
    return doc.toObject();
}

export async function updateSchedule(
    accountId: string,
    scheduleId: string,
    updates: { time?: string; topic?: string; date?: string }
): Promise<ISchedule | null> {
    if (!mongoose.isValidObjectId(scheduleId)) {
        return null;
    }

    const updateData: { time?: string; topic?: string; date?: string } = {};
    if (typeof updates.time === "string" && updates.time.trim().length > 0) {
        updateData.time = updates.time.trim();
    }
    if (typeof updates.topic === "string" && updates.topic.trim().length > 0) {
        updateData.topic = updates.topic.trim();
    }
    if (typeof updates.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(updates.date)) {
        updateData.date = updates.date;
    }

    return Schedule.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(scheduleId),
            accountId: new mongoose.Types.ObjectId(accountId),
        },
        { $set: updateData },
        { returnDocument: "after" }
    ).lean();
}

export async function deleteSchedule(accountId: string, scheduleId: string): Promise<ISchedule | null> {
    if (!mongoose.isValidObjectId(scheduleId)) {
        return null;
    }

    return Schedule.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(scheduleId),
        accountId: new mongoose.Types.ObjectId(accountId),
    }).lean();
}
