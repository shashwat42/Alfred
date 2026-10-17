import { z } from "zod";

export const guestAuthSchema = {
    body: z
        .object({})
        .strict()
        .optional(),
};

export const prepareOAuthSchema = {
    body: z.object({ flow: z.enum(["browser", "desktop"]), code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
};
export const googleAuthSchema = {
    query: z.object({ state: z.string().regex(/^(desktop_)?[a-f0-9]{64}$/) }).strict(),
};

export const exchangeTicketSchema = {
    body: z
        .object({
            ticket: z
                .string({ message: "Invalid or missing authorization ticket" })
                .trim()
                .min(1, "Invalid or missing authorization ticket"),
            code_verifier: z
                .string()
                .trim()
                .min(32)
                .max(128)
                .optional(),
        })
        .strict(),
};

export const desktopPollSchema = {
    body: z
        .object({
            state: z.string().trim().min(16).max(256),
            code_verifier: z.string().trim().min(32).max(128),
        })
        .strict(),
};

export const googleCallbackSchema = {
    query: z.object({
        code: z.string().trim().optional(),
        state: z.string().trim().optional(),
        error: z.string().trim().optional(),
    }),
};
