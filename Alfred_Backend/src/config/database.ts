import mongoose from "mongoose";
import { env } from "./env.ts";

export async function connectDatabase(): Promise<typeof mongoose> {
    try {
        const connection = await mongoose.connect(env.mongodb.uri);
        console.log("Connected to MongoDB successfully");
        return connection;
    } catch (error) {
        console.error("Failed to connect to MongoDB:", error);
        throw error;
    }
}

export async function disconnectDatabase(): Promise<void> {
    await mongoose.disconnect();
}
