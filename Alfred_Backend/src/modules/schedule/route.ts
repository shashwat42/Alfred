import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { validate } from "../../middleware/validate.middleware.ts";
import {
    createSchedule,
    deleteSchedule,
    listSchedule,
    updateSchedule,
} from "./controller.ts";
import {
    createScheduleSchema,
    listScheduleSchema,
    scheduleIdParamSchema,
    updateScheduleSchema,
} from "./schedule.schema.ts";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listScheduleSchema), listSchedule);
router.post("/", validate(createScheduleSchema), createSchedule);
router.put("/:id", validate(updateScheduleSchema), updateSchedule);
router.patch("/:id", validate(updateScheduleSchema), updateSchedule);
router.delete("/:id", validate(scheduleIdParamSchema), deleteSchedule);

export default router;