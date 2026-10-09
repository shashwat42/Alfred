import { z } from "zod";
import { objectIdSchema } from "../../middleware/validate.middleware.ts";
import { isValidCalendarDate } from "../../utils/dateUtils.ts";

export const calendarDateSchema = z
    .string({ message: "Schedule must include a valid date (YYYY-MM-DD)" })
    .trim()
    .refine((val) => isValidCalendarDate(val), {
        message: "Date must be a valid calendar date in YYYY-MM-DD format",
    });

const scheduleCoreSchema = z
    .object({
        time: z
            .string({ message: "Schedule must include a non-empty time and topic" })
            .trim()
            .min(1, "Schedule must include a non-empty time and topic")
            .max(50, "Time cannot exceed 50 characters"),
        topic: z
            .string({ message: "Schedule must include a non-empty time and topic" })
            .trim()
            .min(1, "Schedule must include a non-empty time and topic")
            .max(200, "Topic cannot exceed 200 characters"),
        date: calendarDateSchema,
    })
    .strict();

export const listScheduleSchema = {
    query: z
        .object({
            date: calendarDateSchema.optional(),
        })
        .strict(),
};

const wrappedScheduleSchema = z
    .object({
        schedule: scheduleCoreSchema,
    })
    .strict()
    .transform((data) => data.schedule);

export const createScheduleSchema = {
    body: z.union([wrappedScheduleSchema, scheduleCoreSchema]),
};

const updateScheduleCoreSchema = z
    .object({
        time: z
            .string()
            .trim()
            .min(1, "Time must be a non-empty string")
            .max(50, "Time cannot exceed 50 characters")
            .optional(),
        topic: z
            .string()
            .trim()
            .min(1, "Topic must be a non-empty string")
            .max(200, "Topic cannot exceed 200 characters")
            .optional(),
        date: calendarDateSchema.optional(),
    })
    .strict()
    .refine(
        (data) => data.time !== undefined || data.topic !== undefined || data.date !== undefined,
        { message: "No valid update fields provided" }
    );

const wrappedUpdateScheduleSchema = z
    .object({
        schedule: updateScheduleCoreSchema,
    })
    .strict()
    .transform((data) => data.schedule);

export const updateScheduleSchema = {
    params: z.object({
        id: objectIdSchema,
    }),
    body: z.union([wrappedUpdateScheduleSchema, updateScheduleCoreSchema]),
};

export const scheduleIdParamSchema = {
    params: z.object({
        id: objectIdSchema,
    }),
};

export type CreateScheduleInput = z.infer<typeof scheduleCoreSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleCoreSchema>;
