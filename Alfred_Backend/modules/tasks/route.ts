import { listTasks } from "./controller.ts";
import { Router } from "express";

const router = Router();
router.get('/', listTasks)

export default router;