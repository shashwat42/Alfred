import { z } from "zod";
import { PolicyError } from "../../security/errors.ts";
import * as tasksService from "../tasks/service.ts";
import * as notesService from "../notes/service.ts";
import * as scheduleService from "../schedule/service.ts";
import type { TaskPriority } from "../../models/task.model.ts";
import { isValidCalendarDate } from "../../utils/dateUtils.ts";

export function isEventInPast(
    eventDate: string,
    eventTime: string,
    referenceDate: Date = new Date()
): boolean {
    const refYear = referenceDate.getFullYear();
    const refMonth = String(referenceDate.getMonth() + 1).padStart(2, "0");
    const refDay = String(referenceDate.getDate()).padStart(2, "0");
    const refDateStr = `${refYear}-${refMonth}-${refDay}`;
    const refMinutes = referenceDate.getHours() * 60 + referenceDate.getMinutes();

    if (eventDate < refDateStr) {
        return true;
    }
    if (eventDate > refDateStr) {
        return false;
    }
    const [eventH, eventM] = eventTime.split(":").map(Number);
    const eventMinutes = (eventH || 0) * 60 + (eventM || 0);
    return eventMinutes < refMinutes;
}

export interface ConfirmedAction {
    type:
        | "task_created"
        | "task_completed"
        | "task_updated"
        | "note_created"
        | "note_updated"
        | "schedule_created"
        | "schedule_updated"
        | "schedule_cleared";
    id: string;
    summary?: string;
}

export interface ToolExecutionResult {
    success: boolean;
    data?: unknown;
    error?: string;
    action?: ConfirmedAction;
}

// In-memory short-lived idempotency cache to protect against rapid duplicate tool calls/retries
const idempotencyCache = new Map<string, { result: ToolExecutionResult; expiresAt: number }>();

function cleanupIdempotencyCache(): void {
    const now = Date.now();
    for (const [key, entry] of idempotencyCache.entries()) {
        if (entry.expiresAt <= now) {
            idempotencyCache.delete(key);
        }
    }
}

// Zod schemas for tool parameters
const createTaskSchema = z.object({
    task: z.string().trim().min(1, "Task description cannot be empty"),
    priority: z
        .enum(["urgent", "high", "medium", "normal", "low"])
        .optional()
        .default("normal"),
});

const listTasksSchema = z.object({});

const completeTaskSchema = z.object({
    taskId: z.string().trim().min(1, "Task ID is required"),
    completed: z.boolean().optional(),
});

const createNoteSchema = z.object({
    title: z.string().trim().optional().default(""),
    content: z.string().trim().optional().default(""),
}).refine((data) => data.title.length > 0 || data.content.length > 0, {
    message: "Note must have either a title or content",
});

const searchNotesSchema = z.object({
    query: z.string().trim(),
});

const updateNoteSchema = z.object({
    noteId: z.string().trim().min(1, "Note ID is required"),
    title: z.string().trim().optional(),
    content: z.string().trim().optional(),
});

const createScheduleEventSchema = z.object({
    topic: z.string().trim().min(1, "Schedule topic is required"),
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
        .refine(isValidCalendarDate, { message: "Date must be a valid calendar date in YYYY-MM-DD format" }),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:MM 24-hour format"),
});

const getScheduleSchema = z.object({
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
        .refine(isValidCalendarDate, { message: "Date must be a valid calendar date in YYYY-MM-DD format" }),
});
const clearScheduleForDateSchema = getScheduleSchema.strict();
const clearAllSchedulesSchema = z.object({}).strict();

const updateScheduleEventSchema = z.object({
    scheduleId: z.string().trim().min(1, "Schedule ID is required"),
    topic: z.string().trim().optional(),
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
        .refine(isValidCalendarDate, { message: "Date must be a valid calendar date in YYYY-MM-DD format" })
        .optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:MM format").optional(),
});

export const AI_TOOLS = [
    {
        type: "function",
        function: {
            name: "createTask",
            description: "Create a new to-do task for the user",
            parameters: {
                type: "object",
                properties: {
                    task: {
                        type: "string",
                        description: "The description or title of the task",
                    },
                    priority: {
                        type: "string",
                        enum: ["urgent", "high", "medium", "normal", "low"],
                        description: "Priority level of the task (default: 'normal')",
                    },
                },
                required: ["task"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listTasks",
            description: "List all active to-do tasks for the user",
            parameters: {
                type: "object",
                properties: {},
            },
        },
    },
    {
        type: "function",
        function: {
            name: "completeTask",
            description: "Mark a task as completed or toggle its completion status",
            parameters: {
                type: "object",
                properties: {
                    taskId: {
                        type: "string",
                        description: "The ID (_id) of the task to complete",
                    },
                    completed: {
                        type: "boolean",
                        description: "Optional explicit completion boolean (true to complete, false to uncomplete)",
                    },
                },
                required: ["taskId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "createNote",
            description: "Save a new note for the user with title and content",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "The title of the note",
                    },
                    content: {
                        type: "string",
                        description: "The content/body of the note",
                    },
                },
                required: ["title", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "searchNotes",
            description: "Search the user's saved notes by keyword in title or content",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The keyword or phrase to search for",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateNote",
            description: "Update an existing saved note's title or content",
            parameters: {
                type: "object",
                properties: {
                    noteId: {
                        type: "string",
                        description: "The ID (_id) of the note to update",
                    },
                    title: {
                        type: "string",
                        description: "Updated title of the note",
                    },
                    content: {
                        type: "string",
                        description: "Updated content of the note",
                    },
                },
                required: ["noteId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "createScheduleEvent",
            description: "Add a scheduled event or meeting to the user's daily timeline",
            parameters: {
                type: "object",
                properties: {
                    topic: {
                        type: "string",
                        description: "The topic or summary of the scheduled event",
                    },
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format (e.g., 2026-10-13)",
                    },
                    time: {
                        type: "string",
                        description: "Time in 24-hour HH:MM format (e.g., 09:00 or 15:30)",
                    },
                },
                required: ["topic", "date", "time"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getSchedule",
            description: "Retrieve scheduled events for a specific date",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format (e.g., 2026-10-13)",
                    },
                },
                required: ["date"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateScheduleEvent",
            description: "Update an existing scheduled event's topic, date, or time",
            parameters: {
                type: "object",
                properties: {
                    scheduleId: {
                        type: "string",
                        description: "The ID (_id) of the event to update",
                    },
                    topic: {
                        type: "string",
                        description: "Updated topic/summary",
                    },
                    date: {
                        type: "string",
                        description: "Updated date in YYYY-MM-DD format",
                    },
                    time: {
                        type: "string",
                        description: "Updated time in HH:MM format",
                    },
                },
                required: ["scheduleId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "clearScheduleForDate",
            description: "Permanently delete all of the user's schedule events on one explicitly requested date. Other dates are preserved. Ask for the date if it is unclear; do not use for deleting a single event.",
            parameters: { type: "object", properties: { date: { type: "string", description: "The date the user asked to clear, YYYY-MM-DD" } }, required: ["date"], additionalProperties: false },
        },
    },
    {
        type: "function",
        function: {
            name: "clearAllSchedules",
            description: "Permanently delete the user's entire schedule across ALL dates. Use only when the user explicitly requests all dates or the entire schedule. For an ambiguous clear request, ask whether they mean one day or all dates first.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
];

/**
 * Validates arguments and executes the requested tool strictly scoped to the authenticated accountId.
 */
export async function executeAiTool(
    toolName: string,
    rawArgsString: string,
    accountId: string
): Promise<ToolExecutionResult> {
    if (!accountId || typeof accountId !== "string") {
        return {
            success: false,
            error: "Authentication error: Missing valid account identity context",
        };
    }

    let parsedArgs: unknown;
    try {
        parsedArgs = rawArgsString && rawArgsString.trim() ? JSON.parse(rawArgsString) : {};
    } catch {
        return {
            success: false,
            error: "Malformed tool arguments: Expected valid JSON",
        };
    }

    // Idempotency check for mutating operations within 15 seconds
    cleanupIdempotencyCache();
    const isMutation = [
        "createTask",
        "completeTask",
        "createNote",
        "updateNote",
        "createScheduleEvent",
        "updateScheduleEvent",
        "clearScheduleForDate",
        "clearAllSchedules",
    ].includes(toolName);

    const idempotencyKey = isMutation
        ? `${accountId}:${toolName}:${JSON.stringify(parsedArgs)}`
        : null;

    if (idempotencyKey) {
        const cached = idempotencyCache.get(idempotencyKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.result;
        }
    }

    try {
        let executionResult: ToolExecutionResult;

        switch (toolName) {
            case "createTask": {
                const validated = createTaskSchema.parse(parsedArgs);
                const created = await tasksService.addTask(
                    accountId,
                    validated.task,
                    validated.priority as TaskPriority
                );
                executionResult = {
                    success: true,
                    data: {
                        id: created._id.toString(),
                        task: created.task,
                        priority: created.priority,
                        completed: created.completed,
                    },
                    action: {
                        type: "task_created",
                        id: created._id.toString(),
                        summary: created.task,
                    },
                };
                break;
            }

            case "listTasks": {
                listTasksSchema.parse(parsedArgs);
                const tasks = await tasksService.getTasks(accountId);
                executionResult = {
                    success: true,
                    data: tasks.map((t) => ({
                        id: t._id.toString(),
                        task: t.task,
                        priority: t.priority,
                        completed: t.completed,
                    })),
                };
                break;
            }

            case "completeTask": {
                const validated = completeTaskSchema.parse(parsedArgs);
                const updated = await tasksService.completeTask(
                    accountId,
                    validated.taskId,
                    validated.completed
                );
                if (!updated) {
                    executionResult = {
                        success: false,
                        error: "Task not found or does not belong to your account",
                    };
                } else {
                    executionResult = {
                        success: true,
                        data: {
                            id: updated._id.toString(),
                            task: updated.task,
                            completed: updated.completed,
                        },
                        action: {
                            type: "task_completed",
                            id: updated._id.toString(),
                            summary: `Task '${updated.task}' completed: ${updated.completed}`,
                        },
                    };
                }
                break;
            }

            case "createNote": {
                const validated = createNoteSchema.parse(parsedArgs);
                const created = await notesService.createNote(
                    accountId,
                    validated.title,
                    validated.content
                );
                executionResult = {
                    success: true,
                    data: {
                        id: created._id.toString(),
                        title: created.title,
                        content: created.content,
                    },
                    action: {
                        type: "note_created",
                        id: created._id.toString(),
                        summary: created.title || "Untitled Note",
                    },
                };
                break;
            }

            case "searchNotes": {
                const validated = searchNotesSchema.parse(parsedArgs);
                const notes = await notesService.searchNotes(accountId, validated.query);
                executionResult = {
                    success: true,
                    data: notes.map((n) => ({
                        id: n._id.toString(),
                        title: n.title,
                        content: n.content,
                        updatedAt: n.updatedAt,
                    })),
                };
                break;
            }

            case "updateNote": {
                const validated = updateNoteSchema.parse(parsedArgs);
                const updates: { title?: string; content?: string } = {};
                if (validated.title !== undefined) updates.title = validated.title;
                if (validated.content !== undefined) updates.content = validated.content;

                const updated = await notesService.updateNote(
                    accountId,
                    validated.noteId,
                    updates
                );
                if (!updated) {
                    executionResult = {
                        success: false,
                        error: "Note not found or does not belong to your account",
                    };
                } else {
                    executionResult = {
                        success: true,
                        data: {
                            id: updated._id.toString(),
                            title: updated.title,
                            content: updated.content,
                        },
                        action: {
                            type: "note_updated",
                            id: updated._id.toString(),
                            summary: updated.title || "Note updated",
                        },
                    };
                }
                break;
            }

            case "createScheduleEvent": {
                const validated = createScheduleEventSchema.parse(parsedArgs);
                const created = await scheduleService.addSchedule(accountId, {
                    topic: validated.topic,
                    date: validated.date,
                    time: validated.time,
                });
                const inPast = isEventInPast(validated.date, validated.time);
                executionResult = {
                    success: true,
                    data: {
                        id: created._id.toString(),
                        topic: created.topic,
                        date: created.date,
                        time: created.time,
                        isPastEvent: inPast,
                        note: inPast
                            ? "This event is scheduled for a past time and will appear on the daily timeline history, but NOT in the Upcoming list."
                            : "This event is scheduled for the future and will appear in the Upcoming list.",
                    },
                    action: {
                        type: "schedule_created",
                        id: created._id.toString(),
                        summary: `${created.topic} on ${created.date} at ${created.time}${inPast ? " (Past Event)" : ""}`,
                    },
                };
                break;
            }

            case "getSchedule": {
                const validated = getScheduleSchema.parse(parsedArgs);
                const events = await scheduleService.getSchedule(accountId, validated.date);
                executionResult = {
                    success: true,
                    data: events.map((e) => ({
                        id: e._id.toString(),
                        topic: e.topic,
                        date: e.date,
                        time: e.time,
                    })),
                };
                break;
            }

            case "updateScheduleEvent": {
                const validated = updateScheduleEventSchema.parse(parsedArgs);
                const updates: { topic?: string; date?: string; time?: string } = {};
                if (validated.topic !== undefined) updates.topic = validated.topic;
                if (validated.date !== undefined) updates.date = validated.date;
                if (validated.time !== undefined) updates.time = validated.time;

                const updated = await scheduleService.updateSchedule(
                    accountId,
                    validated.scheduleId,
                    updates
                );
                if (!updated) {
                    executionResult = {
                        success: false,
                        error: "Schedule event not found or does not belong to your account",
                    };
                } else {
                    executionResult = {
                        success: true,
                        data: {
                            id: updated._id.toString(),
                            topic: updated.topic,
                            date: updated.date,
                            time: updated.time,
                        },
                        action: {
                            type: "schedule_updated",
                            id: updated._id.toString(),
                            summary: `${updated.topic} on ${updated.date} at ${updated.time}`,
                        },
                    };
                }
                break;
            }

            case "clearScheduleForDate": {
                const { date } = clearScheduleForDateSchema.parse(parsedArgs);
                const result = await scheduleService.clearScheduleForDate(accountId, date);
                executionResult = {
                    success: true,
                    data: { date, deletedCount: result.deletedCount },
                    action: { type: "schedule_cleared", id: date, summary: `Cleared ${result.deletedCount} event(s) on ${date}` },
                };
                break;
            }
            case "clearAllSchedules": {
                clearAllSchedulesSchema.parse(parsedArgs);
                const result = await scheduleService.clearAllSchedules(accountId);
                executionResult = {
                    success: true,
                    data: { scope: "all", deletedCount: result.deletedCount },
                    action: { type: "schedule_cleared", id: "all", summary: `Cleared ${result.deletedCount} event(s) across all dates` },
                };
                break;
            }
            default:
                executionResult = {
                    success: false,
                    error: `Unsupported tool '${toolName}'. Supported tools: ${AI_TOOLS.map((t) => t.function.name).join(", ")}`,
                };
        }

        if (idempotencyKey && executionResult.success) {
            idempotencyCache.set(idempotencyKey, {
                result: executionResult,
                expiresAt: Date.now() + 15000, // 15 second idempotency window
            });
        }

        return executionResult;
    } catch (err: unknown) {
        if (err instanceof PolicyError) return { success: false, error: `${err.details.code}: ${err.message}` };
        if (err instanceof z.ZodError) {
            return {
                success: false,
                error: `Invalid tool arguments: ${err.issues.map((i) => i.message).join("; ")}`,
            };
        }

        console.error(`[AI Tool Error] Failed executing ${toolName}:`, { name: err instanceof Error ? err.name : "Unknown" });
        return {
            success: false,
            error: "An internal error occurred while executing the operation.",
        };
    }
}
