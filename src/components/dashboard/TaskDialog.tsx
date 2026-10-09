import type { Dispatch, FormEvent, SetStateAction } from "react";

export function TaskDialog({
    newTask,
    setNewTask,
    handleAddTask,
    taskError,
    setIsTaskDialogOpen,
}: {
    newTask: string;
    setNewTask: (task: string) => void;
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
                    <h2 id="task-dialog-title">Add a to-do</h2>
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
                        aria-label="New to-do"
                        placeholder="Add a to-do..."
                        value={newTask}
                        onChange={(event) => setNewTask(event.target.value)}
                    />
                    <button type="submit" aria-label="Add to-do">+</button>
                </form>
                {taskError && <p className="task-error" role="alert">{taskError}</p>}
            </section>
        </div>
    );
}
