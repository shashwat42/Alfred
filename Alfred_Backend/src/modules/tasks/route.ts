import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { validate } from "../../middleware/validate.middleware.ts";
import {
    clearAllTasks,
    completeTask,
    createTask,
    deleteTask,
    listTasks,
    updateTask,
} from "./controller.ts";
import {
    completeTaskSchema,
    createTaskSchema,
    listTasksSchema,
    taskIdParamSchema,
    updateTaskSchema,
} from "./tasks.schema.ts";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listTasksSchema), listTasks);
router.post("/", validate(createTaskSchema), createTask);
router.patch("/:id/complete", validate(completeTaskSchema), completeTask);
router.put("/:id", validate(updateTaskSchema), updateTask);
router.patch("/:id", validate(updateTaskSchema), updateTask);
router.delete("/clear-all", clearAllTasks);
router.delete("/", clearAllTasks);
router.delete("/:id", validate(taskIdParamSchema), deleteTask);

export default router;