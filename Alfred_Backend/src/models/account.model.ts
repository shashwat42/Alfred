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
