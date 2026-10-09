import { z } from "zod";

export const guestAuthSchema = {
    body: z
        .object({})
        .strict()
        .optional(),
};

export const googleAuthSchema = {
    query: z
        .object({
            flow: z.enum(["browser", "desktop"]).optional(),
            state: z.string().trim().min(16).max(256).optional(),
            code_challenge: z.string().trim().min(32).max(128).optional(),
            code_challenge_method: z.literal("S256").optional(),
        })
        .refine(
            (data) => {
                if (data.flow === "desktop") {
                    return Boolean(data.state && data.code_challenge && data.code_challenge_method === "S256");
                }
                return true;
            },
            {
                message: "Desktop flow requires state, code_challenge, and code_challenge_method=S256",
            }
        ),
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

export const googleCallbackSchema = {
    query: z.object({
        code: z.string().trim().optional(),
        state: z.string().trim().optional(),
        error: z.string().trim().optional(),
    }),
};
