import { Router } from "express";
import { guestAuth, googleAuth, googleAuthCallback } from "./auth.controller.ts";

const router = Router();

router.post("/guest", guestAuth);
router.get("/google", googleAuth);
router.get("/google/callback", googleAuthCallback);

export default router;
