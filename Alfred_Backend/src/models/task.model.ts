import mongoose, { Schema } from "mongoose";

export type TaskPriority = "urgent" | "high" | "medium" | "normal" | "low";

export interface ITask {
    _id: mongoose.Types.ObjectId;
    accountId: mongoose.Types.ObjectId;
    task: string;
    completed: boolean;
    priority: TaskPriority;
    createdAt: Date;
    updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
    {
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            required: true,
            index: true,
        },
        task: {
            type: String,
            required: true,
            trim: true,
        },
        completed: {
            type: Boolean,
            default: false,
        },
        priority: {
            type: String,
            enum: ["urgent", "high", "medium", "normal", "low"],
            default: "normal",
        },
    },
    {
        timestamps: true,
    }
);

taskSchema.index({ accountId: 1, createdAt: -1 });

export const Task = mongoose.model<ITask>("Task", taskSchema);
