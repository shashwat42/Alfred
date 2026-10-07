import express from 'express'
import scheduleRouter from './modules/schedule/route.ts'
import cors from "cors";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));

app.use(express.json());
app.use("/api/schedule", scheduleRouter);

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(8000, () => {
    console.log("Server listening on port 8000");
});