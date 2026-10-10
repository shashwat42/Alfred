import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.ts";
import { validate } from "../../middleware/validate.middleware.ts";
import {
    createNoteHandler,
    deleteNoteHandler,
    getRecentNotesHandler,
    listNotes,
    openNoteHandler,
    updateNoteHandler,
} from "./controller.ts";
import {
    createNoteSchema,
    noteIdParamSchema,
    recentNotesSchema,
    updateNoteSchema,
} from "./note.schema.ts";

const router = Router();

router.use(authMiddleware);

router.get("/", listNotes);
router.get("/recent", validate(recentNotesSchema), getRecentNotesHandler);
router.post("/", validate(createNoteSchema), createNoteHandler);
router.put("/:id", validate(updateNoteSchema), updateNoteHandler);
router.patch("/:id", validate(updateNoteSchema), updateNoteHandler);
router.patch("/:id/open", validate(noteIdParamSchema), openNoteHandler);
router.delete("/:id", validate(noteIdParamSchema), deleteNoteHandler);

export default router;
