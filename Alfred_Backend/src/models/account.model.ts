import mongoose, { Schema } from "mongoose";

export type AccountType = "guest" | "user";

export interface IAccount {
    _id: mongoose.Types.ObjectId;
    type: AccountType;
    guestId?: string | undefined;
    googleId?: string | undefined;
    email?: string | undefined;
    name?: string | undefined;
    picture?: string | undefined;
    sessionVersion?: number;
    migratedTo?: mongoose.Types.ObjectId;
    guestWriteVersion?: number;
    storageBytes?: number;
    cloudSyncEnabled?: boolean;
    onboardingCompleted?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const accountSchema = new Schema<IAccount>(
    {
        type: {
            type: String,
            enum: ["guest", "user"],
            required: true,
        },
        sessionVersion: { type: Number, default: 0 },
        migratedTo: { type: Schema.Types.ObjectId, ref: "Account" },
        guestWriteVersion: { type: Number, default: 0 },
        storageBytes: { type: Number, default: 0 },
        cloudSyncEnabled: { type: Boolean, default: false },
        onboardingCompleted: { type: Boolean, default: false },
        guestId: {
            type: String,
            unique: true,
            sparse: true,
        },
        googleId: {
            type: String,
            unique: true,
            sparse: true,
        },
        email: {
            type: String,
            default: undefined,
        },
        name: {
            type: String,
            default: undefined,
        },
        picture: {
            type: String,
            default: undefined,
        },
    },
    {
        timestamps: true,
    }
);

export const Account = mongoose.model<IAccount>("Account", accountSchema);
