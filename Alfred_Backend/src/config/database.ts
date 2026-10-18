import mongoose from "mongoose";
import { setServers } from "node:dns";
import { env } from "./env.ts";

export async function connectDatabase(): Promise<typeof mongoose> {
    try {
        // Optional process-only override for networks that block Atlas SRV lookups.
        if (env.mongodb.dnsServers.length) setServers(env.mongodb.dnsServers);
        const connection = await mongoose.connect(env.mongodb.uri, { serverSelectionTimeoutMS: 5000 });
        console.log("Connected to MongoDB successfully");
        return connection;
    } catch (error) {
        // Driver errors can contain connection strings or credentials.
        console.error("Failed to connect to MongoDB", { name: error instanceof Error ? error.name : "Unknown" });
        throw error;
    }
}

export async function databaseReady(): Promise<boolean> {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 }, { timeoutMS: 2000 });
        return Boolean(hello.isWritablePrimary && (hello.setName || hello.msg === "isdbgrid"));
    } catch {
        return false;
    }
}

export async function disconnectDatabase(): Promise<void> {
    await mongoose.disconnect();
}
