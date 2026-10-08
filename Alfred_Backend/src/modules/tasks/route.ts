import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import {
    clearAllTasks,
    completeTask,
    createTask,
    deleteTask,
    listTasks,
    updateTask,
} from "./controller.ts";

const router = Router();

router.use(authMiddleware);

router.get("/", listTasks);
router.post("/", createTask);
router.patch("/:id/complete", completeTask);
router.put("/:id", updateTask);
router.patch("/:id", updateTask);
router.delete("/clear-all", clearAllTasks);
router.delete("/", clearAllTasks);
router.delete("/:id", deleteTask);

export default router;