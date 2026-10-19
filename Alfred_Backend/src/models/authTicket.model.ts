import mongoose, { Document, Schema, Types } from "mongoose";

export interface IAuthTicket extends Document {
    ticket: string;
    accountId: Types.ObjectId;
    accountVersion: number;
    profileName?: string | undefined;
    profilePicture?: string | undefined;
    codeChallenge?: string | undefined;
    flow: "browser" | "desktop";
    status: "issued" | "consumed";
    state?: string | undefined;
    createdAt: Date;
    expiresAt: Date;
    consumedAt?: Date | undefined;
}

const authTicketSchema = new Schema<IAuthTicket>(
    {
        ticket: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        accountId: {
            type: Schema.Types.ObjectId,
            ref: "Account",
            required: true,
            index: true,
        },
        accountVersion: { type: Number, required: true, default: 0 },
        profileName: { type: String, maxlength: 100 },
        profilePicture: { type: String, maxlength: 4096 },
        codeChallenge: {
            type: String,
            trim: true,
        },
        flow: {
            type: String,
            enum: ["browser", "desktop"],
            required: true,
        },
        state: {
            type: String,
            trim: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["issued", "consumed"],
            default: "issued",
            required: true,
            index: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 },
        },
        consumedAt: {
            type: Date,
        },
    },
    {
        timestamps: false,
    }
);

export const AuthTicket = mongoose.model<IAuthTicket>("AuthTicket", authTicketSchema);
