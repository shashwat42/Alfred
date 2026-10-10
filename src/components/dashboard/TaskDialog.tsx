import type { Dispatch, FormEvent, SetStateAction } from "react";
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
}: {
    newTask: string;
    setNewTask: (task: string) => void;
    newTaskPriority: TaskPriority;
    setNewTaskPriority: (priority: TaskPriority) => void;
    handleAddTask: (e: FormEvent<HTMLFormElement>) => Promise<void>;
    taskError: string;
    setIsTaskDialogOpen: Dispatch<SetStateAction<boolean>>;
}) {
    return (
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
                    <h2 id="task-dialog-title">Add a task</h2>
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
                        autoFocus
                        aria-label="New task"
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

                    <button type="submit" className="task-submit-btn">
                        Add Task
                    </button>
                </form>
                {taskError && <p className="task-error" role="alert">{taskError}</p>}
            </section>
        </div>
    );
}
