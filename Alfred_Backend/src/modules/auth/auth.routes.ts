import { Router } from "express";
import {
    exchangeTicket,
    googleAuth,
    googleAuthCallback,
    guestAuth,
} from "./auth.controller.ts";

const router = Router();

router.post("/guest", guestAuth);
router.get("/google", googleAuth);
router.get("/google/callback", googleAuthCallback);
router.post("/exchange", exchangeTicket);

export default router;
