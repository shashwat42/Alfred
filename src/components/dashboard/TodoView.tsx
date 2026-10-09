import type { TaskItem } from "../../types/dashboard.ts";
import { Pagination } from "../ui/Pagination.tsx";
import { ITEMS_PER_PAGE } from "../../hooks/useTasks.ts";

export function TodoView({
    visibleTasks,
    taskPage,
    taskPageCount,
    setTaskPage,
    handleToggleTaskComplete,
    handleDeleteTask,
}: {
    visibleTasks: TaskItem[];
    taskPage: number;
    taskPageCount: number;
    setTaskPage: (page: number) => void;
    handleToggleTaskComplete: (id: string, currentCompleted?: boolean) => void;
    handleDeleteTask: (id: string) => void;
}) {
    return (
        <div className="dashboard-list-container">
            {visibleTasks.length > 0 ? (
                <ol className="todo-items-list">
                    {visibleTasks.map((item, index) => {
                        const isCompleted = Boolean(item.completed);
                        const taskKey = item._id || `${item.task}-${taskPage * ITEMS_PER_PAGE + index}`;
                        return (
                            <li
                                key={taskKey}
                                className={`todo-item-row ${isCompleted ? "completed" : ""}`}
                                data-full-text={item.task}
                            >
                                <button
                                    type="button"
                                    className={`todo-checkbox-btn ${isCompleted ? "checked" : ""}`}
                                    onClick={() => handleToggleTaskComplete(item._id, isCompleted)}
                                    aria-label={isCompleted ? `Mark "${item.task}" as incomplete` : `Mark "${item.task}" as complete`}
                                    title={isCompleted ? "Mark as incomplete" : "Mark as complete"}
                                >
                                    {isCompleted ? (
                                        <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    ) : null}
                                </button>
                                <span className="todo-item-text">{item.task}</span>
                                <button
                                    type="button"
                                    className="todo-item-del-btn"
                                    onClick={() => handleDeleteTask(item._id)}
                                    aria-label={`Delete "${item.task}"`}
                                    title="Delete task"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            ) : (
                <div className="dashboard-empty-state">
                    <p>No to-dos yet. Click + to add one.</p>
                </div>
            )}

            <Pagination
                pageCount={taskPageCount}
                currentPage={taskPage}
                onPageChange={setTaskPage}
                label="To-Do"
            />
        </div>
    );
}
