import express from "express";
import accountRouter from "./src/modules/auth/account.routes.ts";
import { sendPolicyError } from "./src/security/errors.ts";
import { reconcileAiRequests } from "./src/security/aiUsage.ts";
import cors from "cors";
import authRouter from "./src/modules/auth/auth.routes.ts";
import scheduleRouter from "./src/modules/schedule/route.ts";
import taskRouter from "./src/modules/tasks/route.ts";
import notesRouter from "./src/modules/notes/route.ts";
import aiRouter from "./src/modules/ai/route.ts";
import { initializeAiService } from "./src/modules/ai/service.ts";
import { connectDatabase, databaseReady, disconnectDatabase } from "./src/config/database.ts";
import type { Server } from "node:http";
import { env } from "./src/config/env.ts";
import { apiRateLimiter, authRateLimiter } from "./src/middleware/rateLimit.middleware.ts";
import notificationRouter from "./src/modules/schedule-notifications/route.ts";
import { initializeSecurityIndexes, requireTransactionTopology } from "./src/security/indexes.ts";
import { startSchedulePush } from "./src/modules/schedule-notifications/pushService.ts";
import { createMonitorRouter } from "./src/modules/monitor/route.ts";
import { finishGoogle } from "./src/modules/monitor/auth.ts";
import { requestMetrics } from "./src/modules/monitor/activity.ts";
import { authMiddleware } from "./src/middleware/auth.middleware.ts";

const app = express();
let server: Server | undefined;
let draining = false;
let stopPush = () => {};
app.set("trust proxy", 1);
app.use(cors({ origin: env.allowedOrigins }));
app.use(requestMetrics);
app.use("/monitor", createMonitorRouter(() => draining));
// Reuse the already registered Google redirect URI without touching app OAuth.
app.get("/auth/google/callback", (req, res, next) => {
    if (typeof req.query.state === "string" && req.query.state.startsWith("monitor_")) {
        next();
    } else next("route");
}, authRateLimiter, finishGoogle);

app.use("/api/account/cloud-sync", express.json({ limit: "12mb" }));
app.use("/api/account/profile", express.json({ limit: "400kb" }));
app.use("/api/ai/chat", express.json({ limit: "12mb" }));
app.use(express.json());
app.use("/auth", authRouter);
app.use("/api", apiRateLimiter);
app.post("/api/presence", authMiddleware, (_req, res) => { res.sendStatus(204); });
app.use("/api/account", accountRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/tasks", taskRouter);
app.use("/api/notes", notesRouter);
app.use("/api/ai", aiRouter);
app.use("/api/schedule-notifications", notificationRouter);


app.get("/health", (_req, res) => {
    res.json({ status: "ok", mode: env.mode });
});
app.get("/ready", async (_req, res) => {
    const ready = !draining && await databaseReady();
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable", mode: env.mode });
});
app.use((_req, res) => { res.status(404).json({ code: "NOT_FOUND", error: "API endpoint not found" }); });

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(error); return; }
    if (sendPolicyError(error, res)) return;
    console.error("Unhandled request failure", { name: error instanceof Error ? error.name : "Unknown" });
    res.status(503).json({ error: "The service is temporarily unavailable. Please try again." });
});

async function startServer(): Promise<void> {
    try {
        await connectDatabase();
        await requireTransactionTopology();
        await initializeSecurityIndexes();
        await reconcileAiRequests();
        void initializeAiService();
        if (draining) { await disconnectDatabase(); return; }
        stopPush = startSchedulePush();
        server = app.listen(env.port, () => {
            console.log(`Server listening on port ${env.port}`);
        });
    } catch (err) {
        console.error("Failed to start server", { name: err instanceof Error ? err.name : "Unknown" });
        process.exit(1);
    }
}

async function shutdown(): Promise<void> {
    if (draining) return;
    draining = true;
    stopPush();
    const deadline = setTimeout(() => { server?.closeAllConnections(); process.exit(1); }, 35_000);
    deadline.unref();
    try {
        if (server) await new Promise<void>((resolve, reject) => {
            server!.close(error => error ? reject(error) : resolve());
            server!.closeIdleConnections();
        });
        await disconnectDatabase();
        clearTimeout(deadline);
        process.exit(0);
    } catch {
        process.exit(1);
    }
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

void startServer();
// Server reloaded with account-scoped tasks & schedule
