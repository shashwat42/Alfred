import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import {
    createSchedule,
    deleteSchedule,
    listSchedule,
    updateSchedule,
} from "./controller.ts";

const router = Router();

router.use(authMiddleware);

router.get("/", listSchedule);
router.post("/", createSchedule);
router.put("/:id", updateSchedule);
router.patch("/:id", updateSchedule);
router.delete("/:id", deleteSchedule);

export default router;