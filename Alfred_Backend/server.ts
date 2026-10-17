import express from "express";
import cors from "cors";
import authRouter from "./src/modules/auth/auth.routes.ts";
import scheduleRouter from "./src/modules/schedule/route.ts";
import taskRouter from "./src/modules/tasks/route.ts";
import notesRouter from "./src/modules/notes/route.ts";
import aiRouter from "./src/modules/ai/route.ts";
import { initializeAiService } from "./src/modules/ai/service.ts";
import { connectDatabase } from "./src/config/database.ts";
import { env } from "./src/config/env.ts";
import { apiRateLimiter } from "./src/middleware/rateLimit.middleware.ts";
import notificationRouter from "./src/modules/schedule-notifications/route.ts";
import { initializeSecurityIndexes, requireTransactionTopology } from "./src/security/indexes.ts";

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: env.allowedOrigins }));

app.use(express.json());
app.use("/auth", authRouter);
app.use("/api", apiRateLimiter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/tasks", taskRouter);
app.use("/api/notes", notesRouter);
app.use("/api/ai", aiRouter);
app.use("/api/schedule-notifications", notificationRouter);


app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(error); return; }
    console.error("Unhandled request failure", { name: error instanceof Error ? error.name : "Unknown" });
    res.status(503).json({ error: "The service is temporarily unavailable. Please try again." });
});

async function startServer(): Promise<void> {
    try {
        await connectDatabase();
        await requireTransactionTopology();
        await initializeSecurityIndexes();
        void initializeAiService();
        app.listen(env.port, () => {
            console.log(`Server listening on port ${env.port}`);
        });
    } catch (err) {
        console.error("Failed to start server:", err instanceof Error ? err.message : "Unknown error");
        process.exit(1);
    }
}

void startServer();
// Server reloaded with account-scoped tasks & schedule
