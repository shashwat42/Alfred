import mongoose, { Document, Schema } from "mongoose";

export interface IOAuthState extends Document {
    state: string;
    codeChallenge?: string | undefined;
    codeChallengeMethod?: string | undefined;
    flow: "browser" | "desktop";
    createdAt: Date;
    expiresAt: Date;
}

const oauthStateSchema = new Schema<IOAuthState>(
    {
        state: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        codeChallenge: {
            type: String,
            trim: true,
        },
        codeChallengeMethod: {
            type: String,
            trim: true,
        },
        flow: {
            type: String,
            enum: ["browser", "desktop"],
            default: "browser",
            required: true,
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
    },
    {
        timestamps: false,
    }
);

export const OAuthState = mongoose.model<IOAuthState>("OAuthState", oauthStateSchema);
