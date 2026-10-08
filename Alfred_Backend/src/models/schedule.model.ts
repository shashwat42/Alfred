import mongoose, { Schema } from "mongoose";

export interface ISchedule {
    _id: mongoose.Types.ObjectId;
    accountId: mongoose.Types.ObjectId;
    time: string;
    topic: string;
    date: string;
    createdAt: Date;
    updatedAt: Date;
}

const scheduleSchema = new Schema<ISchedule>(
    {
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            required: true,
            index: true,
        },
        time: {
            type: String,
            required: true,
            trim: true,
        },
        topic: {
            type: String,
            required: true,
            trim: true,
        },
        date: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

scheduleSchema.index({ accountId: 1, date: 1 });

export const Schedule = mongoose.model<ISchedule>("Schedule", scheduleSchema);
