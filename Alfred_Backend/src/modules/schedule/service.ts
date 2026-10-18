import { tenantRepository } from "../../security/tenantRepository.ts";
import mongoose from "mongoose";
import { Schedule, type ISchedule } from "../../models/schedule.model.ts";
import { isValidCalendarDate } from "../../utils/dateUtils.ts";

export type ScheduleItem = {
    _id?: string;
    time: string;
    topic: string;
    date: string;
};

export async function getSchedule(accountId: string, date: string): Promise<ISchedule[]> {
    return tenantRepository(Schedule, accountId).find({
        date,
    }, { sort: { time: 1 } });
}

export async function addSchedule(
    accountId: string,
    item: { time: string; topic: string; date: string }
): Promise<ISchedule> {
    const doc = await tenantRepository(Schedule, accountId).create({
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

    return tenantRepository(Schedule, accountId).findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(scheduleId),
        },
        updateData
    );
}

export async function deleteSchedule(accountId: string, scheduleId: string): Promise<ISchedule | null> {
    if (!mongoose.isValidObjectId(scheduleId)) {
        return null;
    }

    return tenantRepository(Schedule, accountId).findOneAndDelete({
        _id: new mongoose.Types.ObjectId(scheduleId),
    });
}

export async function clearScheduleForDate(accountId: string, date: string) {
    if (!isValidCalendarDate(date)) throw new Error("A valid calendar date in YYYY-MM-DD format is required");
    return tenantRepository(Schedule, accountId).deleteMany({ date });
}

export async function clearAllSchedules(accountId: string) {
    return tenantRepository(Schedule, accountId).deleteMany();
}
