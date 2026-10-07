import { Router } from 'express'

import { listSchedule } from './controller.ts'
const router = Router();

router.get("/", listSchedule);

export default router;