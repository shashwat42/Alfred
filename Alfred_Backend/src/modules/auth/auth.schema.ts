import { z } from "zod";

export const guestAuthSchema = {
    body: z
        .object({})
        .strict()
        .optional(),
};

export const exchangeTicketSchema = {
    body: z
        .object({
            ticket: z
                .string({ message: "Invalid or missing authorization ticket" })
                .trim()
                .min(1, "Invalid or missing authorization ticket"),
        })
        .strict(),
};

export const googleCallbackSchema = {
    query: z.object({
        code: z.string().trim().optional(),
        error: z.string().trim().optional(),
    }),
};
