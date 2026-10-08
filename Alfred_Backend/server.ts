import express from "express";
import cors from "cors";
import authRouter from "./src/modules/auth/auth.routes.ts";
import scheduleRouter from "./src/modules/schedule/route.ts";
import taskRouter from "./src/modules/tasks/route.ts";
import { connectDatabase } from "./src/config/database.ts";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));

app.use(express.json());
app.use("/auth", authRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/tasks", taskRouter);

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

async function startServer(): Promise<void> {
    try {
        await connectDatabase();
        app.listen(8000, () => {
            console.log("Server listening on port 8000");
        });
    } catch (err) {
        console.error("Failed to start server due to database connection error:", err);
        process.exit(1);
    }
}

void startServer();
// Server reloaded with account-scoped tasks & schedule
