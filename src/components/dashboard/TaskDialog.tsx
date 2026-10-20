import { ErrorNotice } from "../reliability/Notifications";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { TaskPriority } from "../../types/dashboard.ts";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
    { value: "normal", label: "Normal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
];

export function TaskDialog({
    newTask,
    setNewTask,
    newTaskPriority,
    setNewTaskPriority,
    handleAddTask,
    taskError,
    setIsTaskDialogOpen,
    isSubmitting = false,
    isEditing = false,
}: {
    newTask: string;
    setNewTask: (task: string) => void;
    newTaskPriority: TaskPriority;
    setNewTaskPriority: (priority: TaskPriority) => void;
    handleAddTask: (e: FormEvent<HTMLFormElement>) => Promise<void>;
    taskError: string;
    setIsTaskDialogOpen: Dispatch<SetStateAction<boolean>>;
    isSubmitting?: boolean;
    isEditing?: boolean;
}) {
    return createPortal(
        <div
            className="task-dialog-backdrop"
            onClick={(event) => {
                if (event.target === event.currentTarget) setIsTaskDialogOpen(false);
            }}
        >
            <section
                className="task-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="task-dialog-title"
            >
                <div className="task-dialog-heading">
                    <h2 id="task-dialog-title">{isEditing ? "Edit task" : "Add a task"}</h2>
                    <button
                        className="task-dialog-close"
                        type="button"
                        aria-label="Close dialog"
                        onClick={() => setIsTaskDialogOpen(false)}
                    >
                        ×
                    </button>
                </div>
                <form className="task-add-form" onSubmit={handleAddTask}>
                    <input
                        disabled={isSubmitting}
                        autoFocus
                        aria-label={isEditing ? "Task text" : "New task"}
                        required
                        maxLength={500}
                        placeholder="Add a task..."
                        value={newTask}
                        onChange={(event) => setNewTask(event.target.value)}
                    />
                    
                    <div className="task-priority-picker">
                        <span className="task-priority-header">Priority:</span>
                        <div className="task-priority-options">
                            {PRIORITIES.map((p) => (
                                <button
                                    key={p.value}
                                    disabled={isSubmitting}
                                    type="button"
                                    className={`task-priority-btn priority-${p.value} ${
                                        newTaskPriority === p.value ? "selected" : ""
                                    }`}
                                    onClick={() => setNewTaskPriority(p.value)}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button type="submit" className="task-submit-btn" disabled={isSubmitting || !newTask.trim()}>
                        {isSubmitting ? "Saving task…" : isEditing ? "Save changes" : "Add Task"}
                    </button>
                </form>
                <ErrorNotice message={taskError} />
            </section>
        </div>,
        document.body
    );
}
