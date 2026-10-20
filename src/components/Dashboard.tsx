import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Loader, ErrorState, Modal } from "./reliability/States";
import { useAuth } from "../auth/authContext.ts";
import type { DashboardView } from "../types/dashboard.ts";
import type { NoteItem } from "../types/notes.ts";
import { useTasks, ITEMS_PER_PAGE } from "../hooks/useTasks.ts";
import { useSchedule } from "../hooks/useSchedule.ts";
import { useNotes } from "../hooks/useNotes.ts";
import { useDashboardAutoRefresh } from "../hooks/useDashboardAutoRefresh.ts";

import { DashboardHeader } from "./dashboard/DashboardHeader.tsx";
import { DashboardNav } from "./dashboard/DashboardNav.tsx";
import { WorkspaceView } from "./dashboard/WorkspaceView.tsx";
import { UpcomingView } from "./dashboard/UpcomingView.tsx";
import { ScheduleTimelineView } from "./dashboard/ScheduleTimelineView.tsx";
import { TodoView } from "./dashboard/TodoView.tsx";
import { NotesView } from "./dashboard/NotesView.tsx";
import { SettingsView } from "./dashboard/SettingsView.tsx";
import { CalendarDialog } from "./dashboard/CalendarDialog.tsx";
import { TaskDialog } from "./dashboard/TaskDialog.tsx";
import { ScheduleDialog } from "./dashboard/ScheduleDialog.tsx";
import { FocusSession } from "./focus/FocusSession.tsx";
import { useFocusSession, formatTimeMMSS } from "../hooks/useFocusSession.ts";
import { NOTIFICATION_OPEN_EVENT } from "../lib/scheduleNotifications.ts";

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
    const isAndroid = /Android/i.test(navigator.userAgent);
    const [isFocusSessionOpen, setIsFocusSessionOpen] = useState(false);
    const [isAbsorbing, setIsAbsorbing] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const focusTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (focusTransitionRef.current) clearTimeout(focusTransitionRef.current);
    }, []);
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
        handleEditTask,
        handleStartNewTask,
        editingTaskId,
        handleToggleTaskComplete,
        handleDeleteTask,
        handleClearAllTasks,
        refreshTasks,
        isLoading: tasksLoading, loadError: tasksLoadError, hasLoaded: tasksLoaded,
        isSubmitting: taskSubmitting,
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
        handleEditSchedule,
        handleStartNewSchedule,
        editingSchedule,
        handleDeleteSchedule,
        handleClearSchedules,
        isClearing: scheduleClearing,
        handlePrevDay,
        handleNextDay,
        handleToday,
        refreshSchedule,
        isLoading: scheduleLoading, loadError: scheduleLoadError, hasLoaded: scheduleLoaded,
        isSubmitting: scheduleSubmitting,
    } = useSchedule(accountId, todayDateStr);
    const [clearScheduleScope, setClearScheduleScope] = useState<string | null>(null);

    const [notificationTarget, setNotificationTarget] = useState<{ scheduleId: string } | null>(null);
    const focusedNotification = useRef<typeof notificationTarget>(null);
    useEffect(() => {
        const open = (event: Event) => {
            const target = (event as CustomEvent<{ date: string; scheduleId: string }>).detail;
            const date = new Date(`${target.date}T12:00:00`);
            if (!Number.isNaN(date.getTime())) setScheduleSelectedDate(date);
            setNotificationTarget({ scheduleId: target.scheduleId });
        };
        window.addEventListener(NOTIFICATION_OPEN_EVENT, open);
        return () => window.removeEventListener(NOTIFICATION_OPEN_EVENT, open);
    }, [setScheduleSelectedDate]);
    useEffect(() => {
        if (!notificationTarget || notificationTarget === focusedNotification.current || activeView !== "schedule") return;
        const element = document.getElementById(`schedule-${notificationTarget.scheduleId}`);
        if (element) { focusedNotification.current = notificationTarget; element.scrollIntoView({ block: "center" }); element.focus({ preventScroll: true }); }
    }, [notificationTarget, timelineSchedule, activeView]);

    const {
        notes,
        recentNotes,
        activeNote,
        setActiveNote,
        saveNote,
        deleteNote,
        openNote,
        refreshNotes,
        notesError,
        isLoading: notesLoading, loadError: notesLoadError, hasLoaded: notesLoaded,
    } = useNotes(accountId);

    const {
        isRefreshing,
        lastRefreshedAt,
        refreshAll,
        refreshError,
    } = useDashboardAutoRefresh({
        accountId,
        refreshTasks,
        refreshSchedule,
        refreshNotes,
    });

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
        if (focusTransitionRef.current) clearTimeout(focusTransitionRef.current);
        setIsExpanding(false);
        setIsAbsorbing(true);
        focusTransitionRef.current = setTimeout(() => {
            focusTransitionRef.current = null;
            setIsAbsorbing(false);
            setIsFocusSessionOpen(true);
        }, 340);
    }, []);

    const handleReturnToDashboard = useCallback(() => {
        if (focusTransitionRef.current) clearTimeout(focusTransitionRef.current);
        setIsAbsorbing(false);
        setIsFocusSessionOpen(false);
        if (isAndroid) {
            if (onViewChange) onViewChange("workspace"); else setLocalView("workspace");
        }
        setIsExpanding(true);
        focusTransitionRef.current = setTimeout(() => {
            focusTransitionRef.current = null;
            setIsExpanding(false);
        }, 380);
    }, [isAndroid, onViewChange]);

    useEffect(() => {
        const back = (event: Event) => {
            if (document.querySelector("dialog[open]")) return;
            if (isTaskDialogOpen || isScheduleDialogOpen || isCalendarOpen) {
                event.preventDefault(); setIsTaskDialogOpen(false); setIsScheduleDialogOpen(false); setIsCalendarOpen(false);
            } else if (isFocusSessionOpen) { event.preventDefault(); handleReturnToDashboard(); }
        };
        window.addEventListener("alfred:back", back, true);
        return () => window.removeEventListener("alfred:back", back, true);
    }, [isTaskDialogOpen, isScheduleDialogOpen, isCalendarOpen, isFocusSessionOpen, handleReturnToDashboard, setIsTaskDialogOpen, setIsScheduleDialogOpen, setIsCalendarOpen]);

    const handleViewChange = useCallback((view: DashboardView) => {
        const navigation = new CustomEvent("alfred:before-navigate", { cancelable: true, detail: () => {
            setActiveNote(null);
            if (onViewChange) onViewChange(view); else setLocalView(view);
        } });
        if (!window.dispatchEvent(navigation)) return;
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
                    returnDestination={isAndroid ? "Workspace" : "Dashboard"}
                    onReturn={handleReturnToDashboard}
                    focusSession={focusSession}
                />
            ) : (
                <>
                    <div className={`dashboard-main-card is-view-${activeView} ${["workspace", "schedule", "notes", "mails", "tasks", "todo", "settings"].includes(activeView) ? "is-section-workspace" : ""} ${isAbsorbing ? "is-absorbing" : isExpanding ? "is-expanding" : ""}`}>
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
                        onAddSchedule={handleStartNewSchedule}
                        setNewScheduleDate={setNewScheduleDate}
                        setIsScheduleDialogOpen={setIsScheduleDialogOpen}
                        activeTasks={activeTasks}
                        handleClearAllTasks={handleClearAllTasks}
                        setTaskError={setTaskError}
                        onAddTask={handleStartNewTask}
                        setIsTaskDialogOpen={setIsTaskDialogOpen}
                        isScheduleDialogOpen={isScheduleDialogOpen}
                        isTaskDialogOpen={isTaskDialogOpen}
                        onRefresh={refreshAll}
                        isRefreshing={isRefreshing}
                        lastRefreshedAt={lastRefreshedAt}
                        onClearScheduleDay={() => setClearScheduleScope(scheduleDate)}
                        onClearScheduleAll={() => setClearScheduleScope("all")}
                        isScheduleClearing={scheduleClearing || scheduleSubmitting}
                        hasScheduleForDate={activeTimelineSchedule.length > 0}
                    />

                    <div className="dashboard-section-body">
                    {(tasksLoading || scheduleLoading || notesLoading) && (
                        (activeView === "home" && !(tasksLoaded && scheduleLoaded && notesLoaded)) ||
                        (activeView === "schedule" && !scheduleLoaded) ||
                        ((activeView === "tasks" || activeView === "todo") && !tasksLoaded) ||
                        ((activeView === "notes" || activeView === "mails") && !notesLoaded)
                    ) && <Loader label="Loading dashboard sections…" />}
                    {Array.from(new Set([taskError, scheduleError, notesError].filter(Boolean))).map(message => <ErrorState key={message} message={message} />)}
                    {(tasksLoadError || scheduleLoadError || notesLoadError || refreshError) && <ErrorState message={tasksLoadError || scheduleLoadError || notesLoadError || refreshError || "Refresh failed"} retry={() => void refreshAll()} />}
                    {activeView === "home" && tasksLoaded && scheduleLoaded && notesLoaded && (!(tasksLoadError || scheduleLoadError || notesLoadError) || activeTasks.length + activeTodaySchedule.length + activeRecentNotes.length > 0) && (
                        <UpcomingView
                            scheduleItems={activeTodaySchedule}
                            priorityTasks={activeTasks}
                            currentMinutes={currentMinutes}
                            recentNotes={activeRecentNotes}
                            hasNotes={activeNotes.length > 0}
                            onOpenNote={handleOpenNoteFromUpcoming}
                            onSaveQuickNote={handleSaveQuickNote}
                            onOpenFocusSession={isAndroid ? undefined : handleOpenFocusSession}
                            focusTime={focusSession.isRunning ? formatTimeMMSS(focusSession.remainingSeconds) : undefined}
                        />
                    )}

                    {activeView === "schedule" && scheduleLoaded && (!scheduleLoadError || activeTimelineSchedule.length > 0) && (
                        <ScheduleTimelineView
                            activeTimelineSchedule={activeTimelineSchedule}
                            scheduleDate={scheduleDate}
                            todayDateStr={todayDateStr}
                            currentMinutes={currentMinutes}
                            currentHourRef={currentHourRef}
                            handleDeleteSchedule={handleDeleteSchedule}
                            onEditSchedule={handleEditSchedule}
                        />
                    )}

                    {(activeView === "tasks" || activeView === "todo") && tasksLoaded && (!tasksLoadError || activeTasks.length > 0) && (
                        <TodoView
                            visibleTasks={visibleTasks}
                            taskPage={taskPage}
                            taskPageCount={taskPageCount}
                            setTaskPage={setTaskPage}
                            handleToggleTaskComplete={handleToggleTaskComplete}
                            handleDeleteTask={handleDeleteTask}
                            onEditTask={handleEditTask}
                        />
                    )}

                    {(activeView === "notes" || activeView === "mails") && notesLoaded && (!notesLoadError || activeNotes.length > 0) && (
                        <NotesView
                            operationError={notesError}
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

                    {activeView === "workspace" && <WorkspaceView onNavigate={handleViewChange} onOpenFocusSession={isAndroid ? handleOpenFocusSession : undefined} focusTime={focusSession.isRunning ? formatTimeMMSS(focusSession.remainingSeconds) : undefined} />}
                    {activeView === "settings" && <SettingsView />}
                    </div>
                </div>

                <div className="dashboard-nav-divider" aria-hidden="true" />

                <DashboardNav activeView={activeView} handleViewChange={handleViewChange} />
            </div>
            </>
            )}

            {clearScheduleScope && <Modal title={clearScheduleScope === "all" ? "Clear all schedule dates?" : "Clear this day’s schedule?"} onClose={() => { if (!scheduleClearing) setClearScheduleScope(null); }}>
                <p>{clearScheduleScope === "all" ? "This permanently deletes every event in your schedule, across all dates." : `This permanently deletes all your events on ${clearScheduleScope}. Other dates are kept.`} This cannot be undone.</p>
                <div className="schedule-clear-confirm-actions"><button type="button" disabled={scheduleClearing} onClick={() => setClearScheduleScope(null)}>Cancel</button><button type="button" className="danger" disabled={scheduleClearing} onClick={async () => { if (await handleClearSchedules(clearScheduleScope === "all" ? "all" : "date", clearScheduleScope === "all" ? undefined : clearScheduleScope)) setClearScheduleScope(null); }}>{scheduleClearing ? "Clearing…" : clearScheduleScope === "all" ? "Clear all dates" : "Clear day"}</button></div>
            </Modal>}
            {isCalendarOpen && (
                <CalendarDialog
                    scheduleSelectedDate={scheduleSelectedDate}
                    setScheduleSelectedDate={setScheduleSelectedDate}
                    setIsCalendarOpen={setIsCalendarOpen}
                />
            )}

            {isTaskDialogOpen && (
                <TaskDialog
                    isEditing={Boolean(editingTaskId)}
                    isSubmitting={taskSubmitting}
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
                    isEditing={Boolean(editingSchedule)}
                    isSubmitting={scheduleSubmitting}
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
