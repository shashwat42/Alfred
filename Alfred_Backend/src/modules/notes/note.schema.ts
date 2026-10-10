import { z } from "zod";
import { objectIdSchema } from "../../middleware/validate.middleware.ts";

export const createNoteSchema = {
    body: z
        .object({
            title: z.string().trim().max(200, "Title cannot exceed 200 characters").optional(),
            content: z.string().max(50000, "Content cannot exceed 50,000 characters").optional(),
        })
        .strict(),
};

export const updateNoteSchema = {
    params: z.object({
        id: objectIdSchema,
    }),
    body: z
        .object({
            title: z.string().trim().max(200, "Title cannot exceed 200 characters").optional(),
            content: z.string().max(50000, "Content cannot exceed 50,000 characters").optional(),
        })
        .strict()
        .refine(
            (data) => data.title !== undefined || data.content !== undefined,
            { message: "At least one field (title or content) must be provided for update" }
        ),
};

export const noteIdParamSchema = {
    params: z.object({
        id: objectIdSchema,
    }),
};

export const recentNotesSchema = {
    query: z.object({
        limit: z.coerce.number().int().min(1).max(20).optional(),
    }),
};

export type CreateNoteInput = z.infer<typeof createNoteSchema.body>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema.body>;
