import type { Dispatch, SetStateAction } from "react";
import type { DashboardView, TaskItem } from "../../types/dashboard.ts";

export function DashboardHeader({
    activeView,
    handleViewChange,
    scheduleSelectedDate,
    scheduleDate,
    todayDateStr,
    setIsCalendarOpen,
    handlePrevDay,
    handleNextDay,
    handleToday,
    setScheduleError,
    setNewScheduleDate,
    setIsScheduleDialogOpen,
    activeTasks,
    handleClearAllTasks,
    setTaskError,
    setIsTaskDialogOpen,
    isScheduleDialogOpen,
    isTaskDialogOpen,
}: {
    activeView: DashboardView;
    handleViewChange: (view: DashboardView) => void;
    scheduleSelectedDate: Date;
    scheduleDate: string;
    todayDateStr: string;
    setIsCalendarOpen: Dispatch<SetStateAction<boolean>>;
    handlePrevDay: () => void;
    handleNextDay: () => void;
    handleToday: () => void;
    setScheduleError: Dispatch<SetStateAction<string>>;
    setNewScheduleDate: Dispatch<SetStateAction<string>>;
    setIsScheduleDialogOpen: Dispatch<SetStateAction<boolean>>;
    activeTasks: TaskItem[];
    handleClearAllTasks: () => void;
    setTaskError: Dispatch<SetStateAction<string>>;
    setIsTaskDialogOpen: Dispatch<SetStateAction<boolean>>;
    isScheduleDialogOpen: boolean;
    isTaskDialogOpen: boolean;
}) {
    return (
        <div className="dashboard-content-header">
            <div className="content-header-title-row">
                {activeView !== "home" && (
                    <button
                        type="button"
                        className="dashboard-back-btn"
                        onClick={() => handleViewChange("home")}
                        aria-label="Back to Homepage"
                    >
                        &lt;
                    </button>
                )}
                <h2 className="dashboard-section-title">
                    {activeView === "home" && "UPCOMING"}
                    {activeView === "schedule" && "SCHEDULE"}
                    {activeView === "todo" && "TO-DO"}
                    {activeView === "mails" && "MAILS"}
                </h2>
            </div>

            {activeView === "schedule" && (
                <div className="schedule-header-actions">
                    <div className="schedule-timeline-toolbar">
                        <div className="timeline-date-nav">
                            <button
                                type="button"
                                className="timeline-nav-arrow"
                                onClick={handlePrevDay}
                                aria-label="Previous day"
                            >
                                ‹
                            </button>
                            <button
                                type="button"
                                className="timeline-date-picker-trigger"
                                onClick={() => setIsCalendarOpen((prev) => !prev)}
                                aria-label="Pick date"
                                title="Open calendar datepicker"
                            >
                                <span>
                                    {scheduleSelectedDate.toLocaleDateString("en-US", {
                                        weekday: "short",
                                        month: "short",
                                        day: "numeric",
                                    })}
                                </span>
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                            </button>
                            <button
                                type="button"
                                className="timeline-nav-arrow"
                                onClick={handleNextDay}
                                aria-label="Next day"
                            >
                                ›
                            </button>
                            <button
                                type="button"
                                className={`timeline-today-btn ${scheduleDate === todayDateStr ? "active" : ""}`}
                                onClick={handleToday}
                            >
                                Today
                            </button>
                        </div>
                    </div>

                    <button
                        className="section-add-trigger"
                        type="button"
                        aria-label="Add schedule item"
                        aria-haspopup="dialog"
                        aria-expanded={isScheduleDialogOpen}
                        onClick={() => {
                            setScheduleError("");
                            setNewScheduleDate(scheduleDate);
                            setIsScheduleDialogOpen(true);
                        }}
                    >
                        +
                    </button>
                </div>
            )}

            {activeView === "todo" && (
                <div className="section-header-actions">
                    {activeTasks.length > 0 && (
                        <button
                            className="section-clear-btn"
                            type="button"
                            aria-label="Clear all tasks"
                            title="Clear all tasks"
                            onClick={handleClearAllTasks}
                        >
                            Clear all
                        </button>
                    )}
                    <button
                        className="section-add-trigger"
                        type="button"
                        aria-label="Add to-do item"
                        aria-haspopup="dialog"
                        aria-expanded={isTaskDialogOpen}
                        onClick={() => {
                            setTaskError("");
                            setIsTaskDialogOpen(true);
                        }}
                    >
                        +
                    </button>
                </div>
            )}
        </div>
    );
}
