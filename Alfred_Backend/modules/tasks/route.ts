import { createTask, listTasks } from "./controller.ts";
import { Router } from "express";

const router = Router();
router.get('/', listTasks)
router.post('/', createTask)

export default router;