import { memo, type Dispatch, type SetStateAction } from "react";
import { Settings, RefreshCw, Plus, ArrowLeft } from "lucide-react";
import { DashboardNav } from "./DashboardNav.tsx";
import type { DashboardView, TaskItem } from "../../types/dashboard.ts";

function DashboardHeaderComponent({
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
    onRefresh,
    isRefreshing = false,
    lastRefreshedAt,
    onClearScheduleDay,
    onClearScheduleAll,
    isScheduleClearing = false,
    hasScheduleForDate = false,
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
    onRefresh?: () => void;
    isRefreshing?: boolean;
    lastRefreshedAt?: Date | null;
    onClearScheduleDay: () => void;
    onClearScheduleAll: () => void;
    isScheduleClearing?: boolean;
    hasScheduleForDate?: boolean;
}) {
    const formattedLastRefresh = lastRefreshedAt
        ? `Last updated: ${lastRefreshedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Refresh dashboard";

    return (
        <div className={`dashboard-content-header ${activeView === "schedule" ? "is-schedule-header" : ""}`}>
            <div className="content-header-title-row">
                {activeView === "home" ? <span className="dashboard-back-placeholder" aria-hidden="true" /> : (
                    <button
                        type="button"
                        className="dashboard-back-btn"
                        onClick={() => { const event = new Event("alfred:back", { cancelable: true }); if (window.dispatchEvent(event)) handleViewChange("home"); }}
                        aria-label="Back to previous screen"
                    >
                        <ArrowLeft size={18} aria-hidden="true" />
                    </button>
                )}
                <h2 className="dashboard-section-title">
                    {activeView === "home" && "UPCOMING"}
                    {activeView === "workspace" && "WORKSPACE"}
                    {activeView === "schedule" && "SCHEDULE"}
                    {(activeView === "tasks" || activeView === "todo") && "TASKS"}
                    {(activeView === "notes" || activeView === "mails") && "NOTES"}
                    {activeView === "settings" && "SETTINGS"}
                </h2>

                {activeView === "home" && !/Android/i.test(navigator.userAgent) && (
                    <button
                        type="button"
                        className="dashboard-settings-btn"
                        onClick={() => handleViewChange("settings")}
                        aria-label="Settings"
                        title="Open Settings"
                    >
                        <Settings size={18} />
                    </button>
                )}
            </div>

            <div className="desktop-dashboard-navigation">
                <DashboardNav activeView={activeView} handleViewChange={handleViewChange} />
            </div>
                {onRefresh && (
                    <button
                        type="button"
                        className={`dashboard-refresh-btn ${isRefreshing ? "is-refreshing" : ""}`}
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        aria-label="Refresh dashboard data"
                        title={isRefreshing ? "Refreshing..." : formattedLastRefresh}
                    >
                        <RefreshCw size={15} className={isRefreshing ? "animate-spin text-red-500" : ""} />
                    </button>
                )}



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

                    <div className="schedule-header-bulk-actions">
                    <button className="section-clear-btn" type="button" disabled={isScheduleClearing || !hasScheduleForDate} onClick={onClearScheduleDay} title={`Clear schedule for ${scheduleDate}`}>Clear day</button>
                    <button className="section-clear-btn" type="button" disabled={isScheduleClearing} onClick={onClearScheduleAll}>Clear all dates</button>
                    <button
                        className="section-add-trigger"
                        type="button"
                        aria-label="Add schedule item"
                        disabled={isScheduleClearing}
                        aria-haspopup="dialog"
                        aria-expanded={isScheduleDialogOpen}
                        onClick={() => {
                            setScheduleError("");
                            setNewScheduleDate(scheduleDate);
                            setIsScheduleDialogOpen(true);
                        }}
                    >
                        <Plus size={18} aria-hidden="true" />
                        <span>Add event</span>
                    </button>
                    </div>
                </div>
            )}

            {(activeView === "tasks" || activeView === "todo") && (
                <div className="section-header-actions">
                    <span className="task-list-summary">
                        {activeTasks.filter((task) => !task.completed).length} remaining
                        <span aria-hidden="true"> · </span>{activeTasks.length} total
                    </span>
                        <button
                            className="section-clear-btn"
                            type="button"
                            aria-label="Clear all tasks"
                            title="Clear all tasks"
                            onClick={handleClearAllTasks}
                            disabled={activeTasks.length === 0}
                        >
                            Clear all
                        </button>
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
                        <Plus size={18} aria-hidden="true" />
                        <span>Add task</span>
                    </button>
                </div>
            )}
        </div>
    );
}

export const DashboardHeader = memo(DashboardHeaderComponent);

