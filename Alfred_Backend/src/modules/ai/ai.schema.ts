import { z } from "zod";

export const MAX_MESSAGE_CONTENT_LENGTH = 4000;
export const MAX_MESSAGES_COUNT = 20;
export const MAX_TOTAL_CONTEXT_CHARS = 20000;

export const chatMessageRoleSchema = z.enum(["user", "assistant"], {
    error: "Role must be either 'user' or 'assistant'. Client system roles are not permitted.",
});

export const chatMessageSchema = z
    .object({
        role: chatMessageRoleSchema,
        content: z
            .string({
                error: "Message content must be a string",
            })
            .trim()
            .min(1, "Message content cannot be empty")
            .max(
                MAX_MESSAGE_CONTENT_LENGTH,
                `Message content cannot exceed ${MAX_MESSAGE_CONTENT_LENGTH} characters`
            ),
    })
    .strict();

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z
    .object({
        messages: z
            .array(chatMessageSchema)
            .max(
                MAX_MESSAGES_COUNT,
                `Conversation context cannot exceed ${MAX_MESSAGES_COUNT} messages`
            )
            .optional(),
        message: z
            .string()
            .trim()
            .min(1, "Latest message content cannot be empty")
            .max(
                MAX_MESSAGE_CONTENT_LENGTH,
                `Latest message content cannot exceed ${MAX_MESSAGE_CONTENT_LENGTH} characters`
            )
            .optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        const assembledMessages: ChatMessageInput[] = [...(data.messages ?? [])];

        if (data.message !== undefined && data.message.trim().length > 0) {
            const trimmedSingle = data.message.trim();
            const lastMsg = assembledMessages[assembledMessages.length - 1];
            if (
                !lastMsg ||
                lastMsg.role !== "user" ||
                lastMsg.content.trim() !== trimmedSingle
            ) {
                assembledMessages.push({
                    role: "user",
                    content: trimmedSingle,
                });
            }
        }

        if (assembledMessages.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "At least one message or message prompt must be provided",
                path: ["messages"],
            });
            return;
        }

        if (assembledMessages.length > MAX_MESSAGES_COUNT) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Total conversation messages cannot exceed ${MAX_MESSAGES_COUNT}`,
                path: ["messages"],
            });
            return;
        }

        const totalChars = assembledMessages.reduce(
            (acc, msg) => acc + msg.content.length,
            0
        );
        if (totalChars > MAX_TOTAL_CONTEXT_CHARS) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Total conversation context exceeds limit of ${MAX_TOTAL_CONTEXT_CHARS} characters`,
                path: ["messages"],
            });
            return;
        }

        const lastMessage = assembledMessages[assembledMessages.length - 1];
        if (!lastMessage || lastMessage.role !== "user") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "The latest message in the conversation sequence must be from role 'user'",
                path: ["messages"],
            });
        }
    });

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
