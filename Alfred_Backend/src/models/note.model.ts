import mongoose, { Schema } from "mongoose";

export interface INote {
    _id: mongoose.Types.ObjectId;
    accountId: mongoose.Types.ObjectId;
    title: string;
    content: string;
    lastOpenedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const noteSchema = new Schema<INote>(
    {
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Account",
            required: true,
            index: true,
        },
        title: {
            type: String,
            default: "",
            trim: true,
        },
        content: {
            type: String,
            default: "",
        },
        lastOpenedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

noteSchema.index({ accountId: 1, createdAt: -1 });
noteSchema.index({ accountId: 1, lastOpenedAt: -1 });

export const Note = mongoose.model<INote>("Note", noteSchema);
