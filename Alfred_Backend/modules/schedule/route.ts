import { Router } from 'express'

import { createSchedule, listSchedule } from './controller.ts'
const router = Router();

router.get("/", listSchedule);
router.post("/", createSchedule);

export default router;