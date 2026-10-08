import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/authContext.ts";
import { apiFetch } from "../lib/api.ts";
import { CalendarWithPresets } from "./ui/calendar-with-presets";
import scheduleIcon from "../assets/schedule.png";
import mailIcon from "../assets/mail.png";
import todoIcon from "../assets/bookmark_filled.png";

export type DashboardView = "home" | "schedule" | "todo" | "mails";

type ScheduleItem = { _id?: string; time: string; topic: string; date: string };
type TaskItem = {
    _id: string;
    task: string;
    completed?: boolean;
    createdAt?: string;
    updatedAt?: string;
};

const ITEMS_PER_PAGE = 5;
const PAGE_WINDOW_SIZE = 5;

const TIMELINE_HOURS = Array.from({ length: 24 }, (_, i) => i);

const EVENT_PALETTE = [
    { bg: "rgba(139, 92, 246, 0.22)", border: "#8b5cf6", text: "#ddd6fe" },
    { bg: "rgba(14, 165, 233, 0.22)", border: "#0ea5e9", text: "#bae6fd" },
    { bg: "rgba(16, 185, 129, 0.22)", border: "#10b981", text: "#a7f3d0" },
    { bg: "rgba(245, 158, 11, 0.22)", border: "#f59e0b", text: "#fde68a" },
    { bg: "rgba(244, 63, 94, 0.22)", border: "#f43f5e", text: "#fecdd3" },
];

function parseTimeToMinutes(timeStr: string): number {
    const clean = timeStr.trim().toLowerCase();
    const isPm = clean.includes("pm");
    const isAm = clean.includes("am");
    const numbers = clean.replace(/[^\d:]/g, "");
    const parts = numbers.split(":");
    let hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;

    if (isPm && hours < 12) hours += 12;
    if (isAm && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

function getRelativeTimeBadge(itemMinutes: number, currentMinutes: number): string {
    const diff = itemMinutes - currentMinutes;
    if (diff <= 0) return "Now";
    if (diff < 60) return `in ${diff}m`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
}

function getVisiblePages(pageCount: number, currentPage: number) {
    if (pageCount <= PAGE_WINDOW_SIZE + 2) {
        return Array.from({ length: pageCount }, (_, index) => index);
    }

    if (currentPage < PAGE_WINDOW_SIZE - 1) {
        return [...Array.from({ length: PAGE_WINDOW_SIZE + 1 }, (_, index) => index), "ellipsis-end", pageCount - 1] as const;
    }

    const firstVisiblePage = Math.min(currentPage - 2, pageCount - PAGE_WINDOW_SIZE);
    const lastVisiblePage = firstVisiblePage + PAGE_WINDOW_SIZE - 1;
    const pages: Array<number | "ellipsis-start" | "ellipsis-end"> = [0];

    if (firstVisiblePage > 1) pages.push("ellipsis-start");
    for (let page = firstVisiblePage; page <= lastVisiblePage; page += 1) pages.push(page);
    if (lastVisiblePage < pageCount - 2) pages.push("ellipsis-end");
    if (lastVisiblePage < pageCount - 1) pages.push(pageCount - 1);

    return pages;
}

function Pagination({
    pageCount,
    currentPage,
    onPageChange,
    label,
}: {
    pageCount: number;
    currentPage: number;
    onPageChange: (page: number) => void;
    label: string;
}) {
    if (pageCount <= 1) return null;

    return (
        <section className="pagination-section" aria-label={`${label} pagination`}>
            <nav className="pagination" aria-label={`${label} pages`}>
                <button
                    className="pagination-arrow"
                    type="button"
                    aria-label={`Previous ${label.toLowerCase()} page`}
                    disabled={currentPage === 0}
                    onClick={() => onPageChange(currentPage - 1)}
                >
                    ‹
                </button>
                <div className="pagination-pages">
                    {getVisiblePages(pageCount, currentPage).map((page) =>
                        typeof page === "number" ? (
                            <button
                                key={page}
                                className="pagination-page"
                                type="button"
                                aria-label={`Show ${label.toLowerCase()} page ${page + 1}`}
                                aria-current={currentPage === page ? "page" : undefined}
                                onClick={() => onPageChange(page)}
                            >
                                {page + 1}
                            </button>
                        ) : (
                            <span key={page} className="pagination-ellipsis" aria-hidden="true">…</span>
                        )
                    )}
                </div>
                <button
                    className="pagination-arrow"
                    type="button"
                    aria-label={`Next ${label.toLowerCase()} page`}
                    disabled={currentPage === pageCount - 1}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    ›
                </button>
            </nav>
        </section>
    );
}

interface DashboardProps {
    currentView?: DashboardView;
    onViewChange?: (view: DashboardView) => void;
}

export default function Dashboard({ currentView = "home", onViewChange }: DashboardProps) {
    const { session } = useAuth();
    const accountId = session?.account?.id;
    const [localView, setLocalView] = useState<DashboardView>(currentView);
    const activeView = onViewChange ? currentView : localView;

    const handleViewChange = (view: DashboardView) => {
        if (onViewChange) {
            onViewChange(view);
        } else {
            setLocalView(view);
        }
    };

    const now = new Date();
    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const todayWeekdayLabel = now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
    const todayMonthDayLabel = now.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();

    const [scheduleSelectedDate, setScheduleSelectedDate] = useState(() => new Date());
    const scheduleDate = `${scheduleSelectedDate.getFullYear()}-${String(scheduleSelectedDate.getMonth() + 1).padStart(2, "0")}-${String(scheduleSelectedDate.getDate()).padStart(2, "0")}`;

    const [todaySchedule, setTodaySchedule] = useState<ScheduleItem[]>([]);
    const [timelineSchedule, setTimelineSchedule] = useState<ScheduleItem[]>([]);
    const [task, setTask] = useState<Array<TaskItem | string>>([]);
    const [taskPage, setTaskPage] = useState(0);
    const [newTask, setNewTask] = useState("");
    const [taskError, setTaskError] = useState("");
    const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);

    const [newScheduleTime, setNewScheduleTime] = useState("");
    const [newScheduleTopic, setNewScheduleTopic] = useState("");
    const [newScheduleDate, setNewScheduleDate] = useState(scheduleDate);
    const [scheduleError, setScheduleError] = useState("");
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const currentHourRef = useRef<HTMLDivElement | null>(null);

    const activeTodaySchedule = accountId ? todaySchedule : [];
    const activeTimelineSchedule = accountId ? timelineSchedule : [];
    const activeTasks = accountId ? task : [];

    const taskPageCount = Math.ceil(activeTasks.length / ITEMS_PER_PAGE);
    const visibleTasks = activeTasks.slice(
        taskPage * ITEMS_PER_PAGE,
        (taskPage + 1) * ITEMS_PER_PAGE
    );

    // Top 3 upcoming tasks strictly >= current time today, sorted closest first
    const upcomingTop3 = activeTodaySchedule
        .filter((item) => {
            const itemMins = parseTimeToMinutes(item.time);
            return itemMins >= currentMinutes;
        })
        .sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time))
        .slice(0, 3);

    useEffect(() => {
        if (!isTaskDialogOpen && !isScheduleDialogOpen && !isCalendarOpen) return;

        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsTaskDialogOpen(false);
                setIsScheduleDialogOpen(false);
                setIsCalendarOpen(false);
            }
        }

        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [isTaskDialogOpen, isScheduleDialogOpen, isCalendarOpen]);

    // Load today's schedule for homepage UPCOMING
    useEffect(() => {
        if (!accountId) return;

        let isMounted = true;

        async function loadTodaySchedule() {
            try {
                const response = await apiFetch(`/api/schedule?date=${todayDateStr}`);
                if (!response.ok) {
                    throw new Error(`Request failed: ${response.status}`);
                }
                const data: ScheduleItem[] = await response.json();
                if (isMounted) {
                    setTodaySchedule(data);
                }
            } catch (error) {
                console.error("Could not load today's schedule:", error);
            }
        }

        void loadTodaySchedule();

        return () => {
            isMounted = false;
        };
    }, [accountId, todayDateStr]);

    // Load schedule for timeline view whenever scheduleDate changes
    useEffect(() => {
        if (!accountId) return;

        let isMounted = true;

        async function loadTimelineSchedule() {
            try {
                const response = await apiFetch(`/api/schedule?date=${scheduleDate}`);
                if (!response.ok) {
                    throw new Error(`Request failed: ${response.status}`);
                }
                const data: ScheduleItem[] = await response.json();
                if (isMounted) {
                    setTimelineSchedule(data);
                }
            } catch (error) {
                console.error("Could not load timeline schedule:", error);
            }
        }

        void loadTimelineSchedule();

        return () => {
            isMounted = false;
        };
    }, [scheduleDate, accountId]);

    // Auto-scroll timeline to current hour when viewing Today
    useEffect(() => {
        if (activeView === "schedule" && scheduleDate === todayDateStr && currentHourRef.current) {
            currentHourRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }, [activeView, scheduleDate, todayDateStr]);

    useEffect(() => {
        if (!accountId) return;

        let isMounted = true;

        async function loadTasks() {
            try {
                const response = await apiFetch("/api/tasks");
                if (!response.ok) {
                    throw new Error(`Request failed: ${response.status}`);
                }
                const data: Array<TaskItem | string> = await response.json();
                if (isMounted) {
                    setTask(data);
                    setTaskPage(0);
                }
            } catch (err) {
                console.error("Could not load tasks:", err);
            }
        }

        void loadTasks();

        return () => {
            isMounted = false;
        };
    }, [accountId]);

    async function handleAddTask(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        const taskName = newTask.trim();
        if (!taskName) return;

        setTaskError("");
        try {
            const response = await apiFetch("/api/tasks", {
                method: "POST",
                body: JSON.stringify({ task: taskName }),
            });
            if (!response.ok) {
                const errorData = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(errorData?.error || `Request failed: ${response.status}`);
            }

            const data = (await response.json()) as TaskItem;
            setTask((currentTasks) => [data, ...currentTasks]);
            setNewTask("");
            setIsTaskDialogOpen(false);
        } catch (error) {
            console.error("Could not add to-do:", error);
            setTaskError(error instanceof Error ? error.message : "Could not add to-do. Please try again.");
        }
    }

    async function handleToggleTaskComplete(id: string, currentCompleted?: boolean) {
        const targetCompleted = !currentCompleted;
        setTask((prev) =>
            prev.map((item) => {
                if (typeof item !== "string" && item._id === id) {
                    return { ...item, completed: targetCompleted };
                }
                return item;
            })
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
                prev.map((item) => {
                    if (typeof item !== "string" && item._id === id) {
                        return updated;
                    }
                    return item;
                })
            );
        } catch (err) {
            console.error("Could not toggle task complete:", err);
            setTask((prev) =>
                prev.map((item) => {
                    if (typeof item !== "string" && item._id === id) {
                        return { ...item, completed: currentCompleted };
                    }
                    return item;
                })
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
                    const nextTasks = prev.filter((item) => (typeof item === "string" ? true : item._id !== id));
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
        if (activeTasks.length === 0) return;
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

    async function handleAddSchedule(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        const time = newScheduleTime.trim();
        const topic = newScheduleTopic.trim();
        if (!time || !topic) return;

        setScheduleError("");
        try {
            const response = await apiFetch("/api/schedule", {
                method: "POST",
                body: JSON.stringify({ schedule: { time, topic, date: newScheduleDate } }),
            });
            if (!response.ok) {
                const errorData = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(errorData?.error || `Request failed: ${response.status}`);
            }

            const data: { schedule: ScheduleItem } = await response.json();
            if (data.schedule.date === todayDateStr) {
                setTodaySchedule((curr) =>
                    [...curr, data.schedule].sort((a, b) => a.time.localeCompare(b.time))
                );
            }
            if (data.schedule.date === scheduleDate) {
                setTimelineSchedule((curr) =>
                    [...curr, data.schedule].sort((a, b) => a.time.localeCompare(b.time))
                );
            }
            setNewScheduleTime("");
            setNewScheduleTopic("");
            setIsScheduleDialogOpen(false);
        } catch (error) {
            console.error("Could not add schedule item:", error);
            setScheduleError(error instanceof Error ? error.message : "Could not add schedule item. Please try again.");
        }
    }

    async function handleDeleteSchedule(id: string) {
        try {
            const response = await apiFetch(`/api/schedule/${id}`, { method: "DELETE" });
            if (response.ok) {
                setTodaySchedule((prev) => prev.filter((item) => item._id !== id));
                setTimelineSchedule((prev) => prev.filter((item) => item._id !== id));
            }
        } catch (err) {
            console.error("Could not delete schedule item:", err);
        }
    }

    const handlePrevDay = () => {
        const prev = new Date(scheduleSelectedDate);
        prev.setDate(prev.getDate() - 1);
        setScheduleSelectedDate(prev);
    };

    const handleNextDay = () => {
        const next = new Date(scheduleSelectedDate);
        next.setDate(next.getDate() + 1);
        setScheduleSelectedDate(next);
    };

    const handleToday = () => {
        setScheduleSelectedDate(new Date());
    };

    return (
        <section className="Dashboard">
            {/* Top Date Banner */}
            <div className="dashboard-date-banner">
                <div className="date-banner-text">
                    <span className="date-banner-weekday">{todayWeekdayLabel}</span>
                    <span className="date-banner-day">{todayMonthDayLabel}</span>
                </div>
            </div>

            {/* Main Unified Card */}
            <div className="dashboard-main-card">
                <div className="dashboard-content-area">
                    {/* View Header */}
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

                        {/* Schedule View Timeline Navigation Toolbar */}
                        {activeView === "schedule" && (
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
                        )}

                        {activeView === "schedule" && (
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

                    {/* View Content 1: Homepage UPCOMING (Top 3 Cards) */}
                    {activeView === "home" && (
                        <div className="upcoming-section-wrapper">
                            {upcomingTop3.length > 0 ? (
                                <div className="upcoming-cards-container">
                                    {upcomingTop3.map((item, index) => {
                                        const mins = parseTimeToMinutes(item.time);
                                        const badge = getRelativeTimeBadge(mins, currentMinutes);
                                        const palette = EVENT_PALETTE[index % EVENT_PALETTE.length];
                                        return (
                                            <article
                                                key={item._id || `${item.time}-${item.topic}`}
                                                className="upcoming-item-card"
                                                style={{ borderLeftColor: palette.border }}
                                            >
                                                <div className="upcoming-card-top">
                                                    <span className="upcoming-card-time">{item.time}</span>
                                                    <span
                                                        className="upcoming-card-badge"
                                                        style={{
                                                            backgroundColor: palette.bg,
                                                            color: palette.text,
                                                            borderColor: palette.border,
                                                        }}
                                                    >
                                                        {badge}
                                                    </span>
                                                </div>
                                                <h3 className="upcoming-card-topic" title={item.topic}>
                                                    {item.topic}
                                                </h3>
                                            </article>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="upcoming-empty-card">
                                    <div className="upcoming-empty-icon">✓</div>
                                    <p className="upcoming-empty-text">No upcoming tasks remaining for today.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* View Content 2: Dedicated SCHEDULE Timeline Interface */}
                    {activeView === "schedule" && (
                        <div className="schedule-timeline-container">
                            <div className="timeline-grid">
                                {TIMELINE_HOURS.map((hour) => {
                                    const hourLabel =
                                        hour === 0
                                            ? "12 AM"
                                            : hour === 12
                                            ? "12 PM"
                                            : hour > 12
                                            ? `${hour - 12} PM`
                                            : `${hour} AM`;

                                    // Find events in this hour slot
                                    const hourEvents = activeTimelineSchedule.filter((item) => {
                                        const mins = parseTimeToMinutes(item.time);
                                        return Math.floor(mins / 60) === hour;
                                    });

                                    const isCurrentHour =
                                        scheduleDate === todayDateStr && now.getHours() === hour;
                                    const nowOffsetPercent = (now.getMinutes() / 60) * 100;

                                    return (
                                        <div
                                            key={hour}
                                            className="timeline-hour-row"
                                            ref={isCurrentHour ? currentHourRef : undefined}
                                        >
                                            <div className="timeline-hour-label">{hourLabel}</div>
                                            <div className="timeline-hour-slot">
                                                {/* Red "Now" line if current hour */}
                                                {isCurrentHour && (
                                                    <div
                                                        className="timeline-now-line"
                                                        style={{ top: `${nowOffsetPercent}%` }}
                                                    >
                                                        <span className="timeline-now-dot" />
                                                    </div>
                                                )}

                                                {/* Event blocks */}
                                                <div className="timeline-events-track">
                                                    {hourEvents.map((eventItem, evIdx) => {
                                                        const palette =
                                                            EVENT_PALETTE[evIdx % EVENT_PALETTE.length];
                                                        return (
                                                            <div
                                                                key={eventItem._id || `${hour}-${evIdx}`}
                                                                className="timeline-event-chip"
                                                                style={{
                                                                    backgroundColor: palette.bg,
                                                                    borderColor: palette.border,
                                                                    color: palette.text,
                                                                }}
                                                            >
                                                                <span className="timeline-chip-time">
                                                                    {eventItem.time}
                                                                </span>
                                                                <span
                                                                    className="timeline-chip-topic"
                                                                    title={eventItem.topic}
                                                                >
                                                                    {eventItem.topic}
                                                                </span>
                                                                {eventItem._id && (
                                                                    <button
                                                                        type="button"
                                                                        className="timeline-chip-del"
                                                                        aria-label={`Remove ${eventItem.topic}`}
                                                                        onClick={() =>
                                                                            handleDeleteSchedule(eventItem._id!)
                                                                        }
                                                                    >
                                                                        ×
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* View Content 3: To-Do View */}
                    {activeView === "todo" && (
                        <div className="dashboard-list-container">
                            {visibleTasks.length > 0 ? (
                                <ol className="todo-items-list">
                                    {visibleTasks.map((item, index) => {
                                        const isObj = typeof item !== "string";
                                        const taskId = isObj ? item._id : "";
                                        const taskName = isObj ? item.task : item;
                                        const isCompleted = isObj ? Boolean(item.completed) : false;
                                        const taskKey =
                                            typeof item === "string"
                                                ? `${item}-${taskPage * ITEMS_PER_PAGE + index}`
                                                : item._id || `${item.task}-${taskPage * ITEMS_PER_PAGE + index}`;
                                        return (
                                            <li
                                                key={taskKey}
                                                className={`todo-item-row ${isCompleted ? "completed" : ""}`}
                                                data-full-text={taskName}
                                            >
                                                <button
                                                    type="button"
                                                    className={`todo-checkbox-btn ${isCompleted ? "checked" : ""}`}
                                                    onClick={() => taskId && handleToggleTaskComplete(taskId, isCompleted)}
                                                    aria-label={isCompleted ? `Mark "${taskName}" as incomplete` : `Mark "${taskName}" as complete`}
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
                                                <span className="todo-item-text">{taskName}</span>
                                                {taskId && (
                                                    <button
                                                        type="button"
                                                        className="todo-item-del-btn"
                                                        onClick={() => handleDeleteTask(taskId)}
                                                        aria-label={`Delete "${taskName}"`}
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
                                                )}
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
                    )}

                    {/* View Content 4: Mails View (Placeholder) */}
                    {activeView === "mails" && (
                        <div className="mails-placeholder-view">
                            <img src={mailIcon} alt="" className="mails-placeholder-icon" />
                            <h3 className="mails-placeholder-title">Mails Integration</h3>
                            <p className="mails-placeholder-subtext">
                                Email accounts and notifications will be available here soon.
                            </p>
                        </div>
                    )}
                </div>

                {/* Vertical Divider */}
                <div className="dashboard-nav-divider" aria-hidden="true" />

                {/* Right 3-Button Nav Strip */}
                <nav className="dashboard-nav-strip" aria-label="Dashboard sections">
                    <button
                        type="button"
                        className={`nav-strip-btn ${activeView === "schedule" ? "active" : ""}`}
                        onClick={() => handleViewChange(activeView === "schedule" ? "home" : "schedule")}
                        aria-label="Schedule"
                        title="Schedule"
                    >
                        <div className="nav-strip-icon-box">
                            <img src={scheduleIcon} alt="" className="nav-strip-icon" />
                        </div>
                        <span className="nav-strip-label">Schedule</span>
                    </button>

                    <button
                        type="button"
                        className={`nav-strip-btn ${activeView === "mails" ? "active" : ""}`}
                        onClick={() => handleViewChange(activeView === "mails" ? "home" : "mails")}
                        aria-label="Mails"
                        title="Mails"
                    >
                        <div className="nav-strip-icon-box">
                            <img src={mailIcon} alt="" className="nav-strip-icon" />
                        </div>
                        <span className="nav-strip-label">Mails</span>
                    </button>

                    <button
                        type="button"
                        className={`nav-strip-btn ${activeView === "todo" ? "active" : ""}`}
                        onClick={() => handleViewChange(activeView === "todo" ? "home" : "todo")}
                        aria-label="To-Do"
                        title="To-Do"
                    >
                        <div className="nav-strip-icon-box">
                            <img src={todoIcon} alt="" className="nav-strip-icon" />
                        </div>
                        <span className="nav-strip-label">To-Do</span>
                    </button>
                </nav>
            </div>

            {/* Calendar Popover / Modal */}
            {isCalendarOpen && (
                <div
                    className="task-dialog-backdrop"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) setIsCalendarOpen(false);
                    }}
                >
                    <section
                        className="calendar-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Calendar date selection"
                    >
                        <div className="task-dialog-heading">
                            <h2>Select Date</h2>
                            <button
                                className="task-dialog-close"
                                type="button"
                                aria-label="Close dialog"
                                onClick={() => setIsCalendarOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <CalendarWithPresets
                            selectedDate={scheduleSelectedDate}
                            onDateChange={(date) => {
                                setScheduleSelectedDate(date);
                                setIsCalendarOpen(false);
                            }}
                        />
                    </section>
                </div>
            )}

            {/* To-Do Dialog */}
            {isTaskDialogOpen && (
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
            )}

            {/* Schedule Dialog */}
            {isScheduleDialogOpen && (
                <div
                    className="task-dialog-backdrop"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) setIsScheduleDialogOpen(false);
                    }}
                >
                    <section
                        className="task-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="schedule-dialog-title"
                    >
                        <div className="task-dialog-heading">
                            <h2 id="schedule-dialog-title">Add to schedule</h2>
                            <button
                                className="task-dialog-close"
                                type="button"
                                aria-label="Close dialog"
                                onClick={() => setIsScheduleDialogOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <form className="schedule-add-form" onSubmit={handleAddSchedule}>
                            <label>
                                Date
                                <input
                                    type="date"
                                    required
                                    value={newScheduleDate}
                                    onChange={(event) => setNewScheduleDate(event.target.value)}
                                />
                            </label>
                            <label>
                                Time
                                <input
                                    autoFocus
                                    type="time"
                                    required
                                    value={newScheduleTime}
                                    onChange={(event) => setNewScheduleTime(event.target.value)}
                                />
                            </label>
                            <label>
                                Topic
                                <input
                                    type="text"
                                    required
                                    placeholder="What is scheduled?"
                                    value={newScheduleTopic}
                                    onChange={(event) => setNewScheduleTopic(event.target.value)}
                                />
                            </label>
                            <button className="task-add-trigger" type="submit">
                                Add schedule
                            </button>
                        </form>
                        {scheduleError && <p className="task-error" role="alert">{scheduleError}</p>}
                    </section>
                </div>
            )}
        </section>
    );
}
