import { useEffect, useState } from "react";
import { useAuth } from "../auth/authContext.ts";
import type { DashboardView } from "../types/dashboard.ts";
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
        setActiveNote(null);
        if (onViewChange) {
            onViewChange(view);
        } else {
            setLocalView(view);
        }
    };

    // Keep 'now' updated regularly so current time and schedule filters advance in real-time
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, 30000);
        return () => clearInterval(timer);
    }, []);

    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const todayWeekdayLabel = now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
    const todayMonthDayLabel = now.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();

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

    const activeTodaySchedule = accountId ? todaySchedule : [];
    const activeTimelineSchedule = accountId ? timelineSchedule : [];
    // task is now typed as TaskItem[] — no string union
    const activeTasks = accountId ? task : [];

    const taskPageCount = Math.ceil(activeTasks.length / ITEMS_PER_PAGE);
    const visibleTasks = activeTasks.slice(
        taskPage * ITEMS_PER_PAGE,
        (taskPage + 1) * ITEMS_PER_PAGE
    );


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
        <section className="Dashboard">
            <div className="dashboard-top-bar">
                <div className="dashboard-date-banner">
                    <div className="date-banner-text">
                        <span className="date-banner-weekday">{todayWeekdayLabel}</span>
                        <span className="date-banner-day">{todayMonthDayLabel}</span>
                    </div>
                </div>
                <button type="button" className="focus-session-btn">
                    Start Focus Session
                </button>
            </div>

            <div className="dashboard-main-card">
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
                            recentNotes={accountId ? recentNotes : []}
                            onOpenNote={(note) => {
                                void openNote(note);
                                if (onViewChange) {
                                    onViewChange("notes");
                                } else {
                                    setLocalView("notes");
                                }
                            }}
                            onSaveQuickNote={async (text) => {
                                await saveNote({ content: text });
                            }}
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
                            notes={accountId ? notes : []}
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
