import { useState, useEffect, useCallback, useRef } from "react";
import { useLoadState } from "./useLoadState";
import { httpMessage } from "../lib/requestError";
import type { FormEvent } from "react";
import { apiFetch } from "../lib/api.ts";
import type { TaskItem, TaskPriority } from "../types/dashboard.ts";

export const ITEMS_PER_PAGE = 5;

/** Custom hook to manage all task-related state and handlers. */
export function useTasks(accountId: string | undefined) {
    const { run, ...loadState } = useLoadState();
    const submission = useRef(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const [task, setTask] = useState<TaskItem[]>([]);
    const [taskPage, setTaskPage] = useState(0);
    const [newTask, setNewTask] = useState("");
    const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("normal");
    const [taskError, setTaskError] = useState("");
    const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);

    const loadTasks = useCallback(async () => run(async () => {
        if (!accountId) return;
        try {
            const response = await apiFetch("/api/tasks");
            if (!response.ok) {
                throw new Error(httpMessage(response.status));
            }
            const data: TaskItem[] = await response.json();
            setTask(data);
            setTaskPage(0);
        } catch (err) {
            console.error("Could not load tasks:", err);
            throw err;
        }
    }), [accountId, run]);

    useEffect(() => {
        if (!accountId) return;

        void loadTasks().catch(() => {});

        const handleActionExecuted = (event: Event) => {
            const customEvt = event as CustomEvent<{ actions?: Array<{ type?: string }> }>;
            const actions = customEvt.detail?.actions;
            if (Array.isArray(actions) && actions.some((a) => a.type && a.type.startsWith("task_"))) {
                void loadTasks().catch(() => {});
            }
        };

        window.addEventListener("alfred:action_executed", handleActionExecuted);

        return () => {
            window.removeEventListener("alfred:action_executed", handleActionExecuted);
        };
    }, [accountId, loadTasks]);

    async function handleAddTask(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const taskName = newTask.trim();
        if (!taskName || submission.current) return;
        submission.current = true; setSubmitting(true);

        setTaskError("");
        try {
            const response = await apiFetch("/api/tasks", {
                method: "POST",
                body: JSON.stringify({ task: taskName, priority: newTaskPriority }),
            });
            if (!response.ok) {
                const errorData = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(errorData?.error || `Request failed: ${response.status}`);
            }

            const data = (await response.json()) as TaskItem;
            setTask((currentTasks) => [data, ...currentTasks]);
            setNewTask("");
            setNewTaskPriority("normal");
            setIsTaskDialogOpen(false);
        } catch (error) {
            console.error("Could not add to-do:", error);
            setTaskError(error instanceof Error ? error.message : "Could not add to-do. Please try again.");
        } finally { submission.current = false; setSubmitting(false); }
    }

    async function handleToggleTaskComplete(id: string, currentCompleted?: boolean) {
        const targetCompleted = !currentCompleted;
        setTask((prev) =>
            prev.map((item) =>
                item._id === id ? { ...item, completed: targetCompleted } : item
            )
        );

        try {
            const response = await apiFetch(`/api/tasks/${id}/complete`, {
                method: "PATCH",
                body: JSON.stringify({ completed: targetCompleted }),
            });
            if (!response.ok) {
                throw new Error(`Failed to update task: ${response.status}`);
            }
            const updated: TaskItem = await response.json();
            setTask((prev) =>
                prev.map((item) => (item._id === id ? updated : item))
            );
        } catch (err) {
            console.error("Could not toggle task complete:", err);
            setTask((prev) =>
                prev.map((item) =>
                    item._id === id ? { ...item, completed: currentCompleted } : item
                )
            );
        }
    }

    async function handleDeleteTask(id: string) {
        try {
            const response = await apiFetch(`/api/tasks/${id}`, {
                method: "DELETE",
            });
            if (response.ok) {
                setTask((prev) => {
                    const nextTasks = prev.filter((item) => item._id !== id);
                    const maxPage = Math.max(0, Math.ceil(nextTasks.length / ITEMS_PER_PAGE) - 1);
                    setTaskPage((p) => Math.min(p, maxPage));
                    return nextTasks;
                });
            }
        } catch (err) {
            console.error("Could not delete task:", err);
        }
    }

    async function handleClearAllTasks() {
        if (task.length === 0) return;
        const confirmClear = window.confirm("Are you sure you want to clear all tasks?");
        if (!confirmClear) return;

        try {
            const response = await apiFetch("/api/tasks/clear-all", {
                method: "DELETE",
            });
            if (response.ok) {
                setTask([]);
                setTaskPage(0);
            }
        } catch (err) {
            console.error("Could not clear all tasks:", err);
        }
    }

    return {
        ...loadState,
        isSubmitting,
        task,
        taskPage,
        setTaskPage,
        newTask,
        setNewTask,
        newTaskPriority,
        setNewTaskPriority,
        taskError,
        setTaskError,
        isTaskDialogOpen,
        setIsTaskDialogOpen,
        handleAddTask,
        handleToggleTaskComplete,
        handleDeleteTask,
        handleClearAllTasks,
        refreshTasks: loadTasks,
    };
}
