import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../auth/authContext.ts";
import type { DashboardView } from "../types/dashboard.ts";
import type { NoteItem } from "../types/notes.ts";
import { useTasks, ITEMS_PER_PAGE } from "../hooks/useTasks.ts";
import { useSchedule } from "../hooks/useSchedule.ts";
import { useNotes } from "../hooks/useNotes.ts";

import { DashboardHeader } from "./dashboard/DashboardHeader.tsx";
import { DashboardNav } from "./dashboard/DashboardNav.tsx";
import { UpcomingView } from "./dashboard/UpcomingView.tsx";
import { ScheduleTimelineView } from "./dashboard/ScheduleTimelineView.tsx";
import { TodoView } from "./dashboard/TodoView.tsx";
import { NotesView } from "./dashboard/NotesView.tsx";
import { CalendarDialog } from "./dashboard/CalendarDialog.tsx";
import { TaskDialog } from "./dashboard/TaskDialog.tsx";
import { ScheduleDialog } from "./dashboard/ScheduleDialog.tsx";
import { FocusSession } from "./focus/FocusSession.tsx";
import { useFocusSession, formatTimeMMSS } from "../hooks/useFocusSession.ts";

const EMPTY_ARRAY: never[] = [];

interface DashboardProps {
    currentView?: DashboardView;
    onViewChange?: (view: DashboardView) => void;
}

export default function Dashboard({ currentView = "home", onViewChange }: DashboardProps) {
    const { session } = useAuth();
    const accountId = session?.account?.id;
    const [localView, setLocalView] = useState<DashboardView>(currentView);
    const activeView = onViewChange ? currentView : localView;
    const [isFocusSessionOpen, setIsFocusSessionOpen] = useState(false);
    const [isAbsorbing, setIsAbsorbing] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const focusSession = useFocusSession();

    // Keep 'now' updated regularly so current time and schedule filters advance in real-time
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, 30000);
        return () => clearInterval(timer);
    }, []);

    const todayDateStr = useMemo(
        () => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
        [now]
    );
    const currentMinutes = useMemo(
        () => now.getHours() * 60 + now.getMinutes(),
        [now]
    );

    const todayWeekdayLabel = useMemo(
        () => now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase(),
        [now]
    );
    const todayMonthDayLabel = useMemo(
        () => now.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase(),
        [now]
    );

    const {
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
    } = useTasks(accountId);

    const {
        scheduleSelectedDate,
        setScheduleSelectedDate,
        scheduleDate,
        todaySchedule,
        timelineSchedule,
        newScheduleTime,
        setNewScheduleTime,
        newScheduleTopic,
        setNewScheduleTopic,
        newScheduleDate,
        setNewScheduleDate,
        scheduleError,
        setScheduleError,
        isScheduleDialogOpen,
        setIsScheduleDialogOpen,
        isCalendarOpen,
        setIsCalendarOpen,
        currentHourRef,
        handleAddSchedule,
        handleDeleteSchedule,
        handlePrevDay,
        handleNextDay,
        handleToday,
    } = useSchedule(accountId, todayDateStr);

    const {
        notes,
        recentNotes,
        activeNote,
        setActiveNote,
        saveNote,
        deleteNote,
        openNote,
    } = useNotes(accountId);

    const activeTodaySchedule = accountId ? todaySchedule : EMPTY_ARRAY;
    const activeTimelineSchedule = accountId ? timelineSchedule : EMPTY_ARRAY;
    const activeTasks = accountId ? task : EMPTY_ARRAY;
    const activeRecentNotes = accountId ? recentNotes : EMPTY_ARRAY;
    const activeNotes = accountId ? notes : EMPTY_ARRAY;

    const taskPageCount = Math.ceil(activeTasks.length / ITEMS_PER_PAGE);
    const visibleTasks = useMemo(
        () =>
            activeTasks.slice(
                taskPage * ITEMS_PER_PAGE,
                (taskPage + 1) * ITEMS_PER_PAGE
            ),
        [activeTasks, taskPage]
    );

    const handleOpenFocusSession = useCallback(() => {
        setIsAbsorbing(true);
        setTimeout(() => {
            setIsAbsorbing(false);
            setIsFocusSessionOpen(true);
        }, 340);
    }, []);

    const handleReturnToDashboard = useCallback(() => {
        setIsFocusSessionOpen(false);
        setIsExpanding(true);
        setTimeout(() => {
            setIsExpanding(false);
        }, 380);
    }, []);

    const handleViewChange = useCallback((view: DashboardView) => {
        setActiveNote(null);
        if (onViewChange) {
            onViewChange(view);
        } else {
            setLocalView(view);
        }
    }, [onViewChange, setActiveNote]);

    const handleOpenNoteFromUpcoming = useCallback((note: NoteItem) => {
        void openNote(note);
        if (onViewChange) {
            onViewChange("notes");
        } else {
            setLocalView("notes");
        }
    }, [openNote, onViewChange]);

    const handleSaveQuickNote = useCallback(async (text: string) => {
        const quickNoteRegex = /^Quick Note(?:\s+(\d+))?$/i;
        let maxNum = 0;
        let hasBaseQuickNote = false;

        for (const n of notes) {
            const match = (n.title || "").trim().match(quickNoteRegex);
            if (match) {
                if (match[1]) {
                    const num = parseInt(match[1], 10);
                    if (!isNaN(num) && num > maxNum) maxNum = num;
                } else {
                    hasBaseQuickNote = true;
                    if (maxNum < 1) maxNum = 1;
                }
            }
        }

        const defaultTitle = (!hasBaseQuickNote && maxNum === 0)
            ? "Quick Note"
            : `Quick Note ${Math.max(maxNum, 1) + 1}`;

        await saveNote({ title: defaultTitle, content: text });
    }, [notes, saveNote]);


    /** Close dialogs on escape key */
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
    }, [isTaskDialogOpen, isScheduleDialogOpen, isCalendarOpen, setIsTaskDialogOpen, setIsScheduleDialogOpen, setIsCalendarOpen]);

    useEffect(() => {
        if (activeView === "schedule" && scheduleDate === todayDateStr && currentHourRef.current) {
            currentHourRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }, [activeView, scheduleDate, todayDateStr, currentHourRef]);

    return (
        <section className={`Dashboard ${isFocusSessionOpen ? "is-focus-mode" : ""} ${isAbsorbing ? "is-absorbing-mode" : ""}`}>
            {isFocusSessionOpen ? (
                <FocusSession
                    todayWeekdayLabel={todayWeekdayLabel}
                    todayMonthDayLabel={todayMonthDayLabel}
                    onReturnToDashboard={handleReturnToDashboard}
                    focusSession={focusSession}
                />
            ) : (
                <>
                    <div className={`dashboard-top-bar ${isAbsorbing ? "is-absorbing" : ""}`}>
                        <div className="dashboard-date-banner">
                            <div className="date-banner-text">
                                <span className="date-banner-weekday">{todayWeekdayLabel}</span>
                                <span className="date-banner-day">{todayMonthDayLabel}</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            className={`focus-session-btn ${focusSession.isRunning ? "is-running-badge" : ""}`}
                            onClick={handleOpenFocusSession}
                            title="Open Focus Session"
                        >
                            {focusSession.isRunning ? (
                                <span className="focus-btn-running-content">
                                    <span className="focus-btn-pulse-dot" />
                                    <span>Focus Session ({formatTimeMMSS(focusSession.remainingSeconds)})</span>
                                </span>
                            ) : (
                                "Focus Session"
                            )}
                        </button>
                    </div>

                    <div className={`dashboard-main-card ${isAbsorbing ? "is-absorbing" : isExpanding ? "is-expanding" : ""}`}>
                <div className="dashboard-content-area">
                    <DashboardHeader
                        activeView={activeView}
                        handleViewChange={handleViewChange}
                        scheduleSelectedDate={scheduleSelectedDate}
                        scheduleDate={scheduleDate}
                        todayDateStr={todayDateStr}
                        setIsCalendarOpen={setIsCalendarOpen}
                        handlePrevDay={handlePrevDay}
                        handleNextDay={handleNextDay}
                        handleToday={handleToday}
                        setScheduleError={setScheduleError}
                        setNewScheduleDate={setNewScheduleDate}
                        setIsScheduleDialogOpen={setIsScheduleDialogOpen}
                        activeTasks={activeTasks}
                        handleClearAllTasks={handleClearAllTasks}
                        setTaskError={setTaskError}
                        setIsTaskDialogOpen={setIsTaskDialogOpen}
                        isScheduleDialogOpen={isScheduleDialogOpen}
                        isTaskDialogOpen={isTaskDialogOpen}
                    />

                    {activeView === "home" && (
                        <UpcomingView
                            scheduleItems={activeTodaySchedule}
                            priorityTasks={activeTasks}
                            currentMinutes={currentMinutes}
                            recentNotes={activeRecentNotes}
                            onOpenNote={handleOpenNoteFromUpcoming}
                            onSaveQuickNote={handleSaveQuickNote}
                        />
                    )}

                    {activeView === "schedule" && (
                        <ScheduleTimelineView
                            activeTimelineSchedule={activeTimelineSchedule}
                            scheduleDate={scheduleDate}
                            todayDateStr={todayDateStr}
                            currentMinutes={currentMinutes}
                            currentHourRef={currentHourRef}
                            handleDeleteSchedule={handleDeleteSchedule}
                        />
                    )}

                    {(activeView === "tasks" || activeView === "todo") && (
                        <TodoView
                            visibleTasks={visibleTasks}
                            taskPage={taskPage}
                            taskPageCount={taskPageCount}
                            setTaskPage={setTaskPage}
                            handleToggleTaskComplete={handleToggleTaskComplete}
                            handleDeleteTask={handleDeleteTask}
                        />
                    )}

                    {(activeView === "notes" || activeView === "mails") && (
                        <NotesView
                            notes={activeNotes}
                            activeNote={activeNote}
                            onSelectNote={(note) => {
                                void openNote(note);
                            }}
                            onSaveNote={saveNote}
                            onDeleteNote={deleteNote}
                            onBackToList={() => setActiveNote(null)}
                        />
                    )}
                </div>

                <div className="dashboard-nav-divider" aria-hidden="true" />

                <DashboardNav activeView={activeView} handleViewChange={handleViewChange} />
            </div>
            </>
            )}

            {isCalendarOpen && (
                <CalendarDialog
                    scheduleSelectedDate={scheduleSelectedDate}
                    setScheduleSelectedDate={setScheduleSelectedDate}
                    setIsCalendarOpen={setIsCalendarOpen}
                />
            )}

            {isTaskDialogOpen && (
                <TaskDialog
                    newTask={newTask}
                    setNewTask={setNewTask}
                    newTaskPriority={newTaskPriority}
                    setNewTaskPriority={setNewTaskPriority}
                    handleAddTask={handleAddTask}
                    taskError={taskError}
                    setIsTaskDialogOpen={setIsTaskDialogOpen}
                />
            )}

            {isScheduleDialogOpen && (
                <ScheduleDialog
                    newScheduleDate={newScheduleDate}
                    setNewScheduleDate={setNewScheduleDate}
                    newScheduleTime={newScheduleTime}
                    setNewScheduleTime={setNewScheduleTime}
                    newScheduleTopic={newScheduleTopic}
                    setNewScheduleTopic={setNewScheduleTopic}
                    handleAddSchedule={handleAddSchedule}
                    scheduleError={scheduleError}
                    setIsScheduleDialogOpen={setIsScheduleDialogOpen}
                />
            )}
        </section>
    );
}
