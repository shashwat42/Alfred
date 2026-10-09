import { z } from "zod";
import { objectIdSchema } from "../../middleware/validate.middleware.ts";

export const listTasksSchema = {
    query: z.object({}).strict(),
};

export const createTaskSchema = {
    body: z
        .object({
            task: z
                .string({ message: "Task must be a non-empty string" })
                .trim()
                .min(1, "Task must be a non-empty string")
                .max(500, "Task cannot exceed 500 characters"),
        })
        .strict(),
};

export const updateTaskSchema = {
    params: z.object({
        id: objectIdSchema,
    }),
    body: z
        .object({
            task: z
                .string({ message: "Task must be a non-empty string" })
                .trim()
                .min(1, "Task must be a non-empty string")
                .max(500, "Task cannot exceed 500 characters")
                .optional(),
            completed: z
                .boolean({ message: "Completed must be a boolean" })
                .optional(),
        })
        .strict()
        .refine(
            (data) => data.task !== undefined || data.completed !== undefined,
            { message: "No valid update fields provided" }
        ),
};

export const completeTaskSchema = {
    params: z.object({
        id: objectIdSchema,
    }),
    body: z
        .object({
            completed: z
                .boolean({ message: "Completed must be a boolean if provided" })
                .optional(),
        })
        .strict()
        .optional(),
};

export const taskIdParamSchema = {
    params: z.object({
        id: objectIdSchema,
    }),
};

export type CreateTaskInput = z.infer<typeof createTaskSchema.body>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema.body>;
