import { useEffect, useState } from "react";
import { CalendarWithPresets } from "./ui/calendar-with-presets";

type ScheduleItem = { time: string; topic: string };

export default function Dashboard() {
    const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
    const [task, setTask] = useState<string[]>([]);
    const [newTask, setNewTask] = useState("");
    const [taskError, setTaskError] = useState("");
    const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
    const [newScheduleTime, setNewScheduleTime] = useState("");
    const [newScheduleTopic, setNewScheduleTopic] = useState("");
    const [scheduleError, setScheduleError] = useState("");
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    useEffect(() => {
        if (!isTaskDialogOpen && !isScheduleDialogOpen) return;

        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsTaskDialogOpen(false);
                setIsScheduleDialogOpen(false);
            }
        }

        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [isTaskDialogOpen, isScheduleDialogOpen]);

    useEffect(() => {
        async function loadSchedule() {
            try {
                const response = await fetch("http://localhost:8000/api/schedule");
                if (!response.ok) {
                    throw new Error(`Request failed: ${response.status}`);
                }
                const data: ScheduleItem[] = await response.json();
                setSchedule(data);
            } catch (error) {
                console.error("Could not load schedule:", error);
            }
        }

        void loadSchedule();
    }, []);


    useEffect(() => {
        async function LoadTasks() {
            try {
                const response = await fetch("http://localhost:8000/api/tasks")  //change in prod
                if (!response.ok) {
                    throw new Error(`Request failed: ${response.status}`);
                }
                const data: string[] = await response.json();
                setTask(data);
            }
            catch (err) {
                console.error("Could not load task", err);
            }
        }
        void LoadTasks();
    }, []);

    async function handleAddTask(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        const taskName = newTask.trim();
        if (!taskName) return;

        setTaskError("");
        try {
            const response = await fetch("http://localhost:8000/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ task: taskName }),
            });
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }

            const data: { task: string } = await response.json();
            setTask((currentTasks) => [...currentTasks, data.task]);
            setNewTask("");
            setIsTaskDialogOpen(false);
        } catch (error) {
            console.error("Could not add task:", error);
            setTaskError("Could not add task. Please try again.");
        }
    }

    async function handleAddSchedule(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        const time = newScheduleTime.trim();
        const topic = newScheduleTopic.trim();
        if (!time || !topic) return;

        setScheduleError("");
        try {
            const response = await fetch("http://localhost:8000/api/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ schedule: { time, topic } }),
            });
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }

            const data: { schedule: ScheduleItem } = await response.json();
            setSchedule((currentSchedule) =>
                [...currentSchedule, data.schedule].sort((a, b) => a.time.localeCompare(b.time))
            );
            setNewScheduleTime("");
            setNewScheduleTopic("");
            setIsScheduleDialogOpen(false);
        } catch (error) {
            console.error("Could not add schedule item:", error);
            setScheduleError("Could not add schedule item. Please try again.");
        }
    }

    return <section className="Dashboard">
        <div className="DashboardLists">
            <section className="DashboardCard ScheduleCard">
                <h1>Today's Schedule</h1>
                <ul>
                    {schedule.map((item) => (
                        <li key={item.time}>{item.time}&nbsp;{item.topic}</li>
                    ))}
                </ul>
                <div className="scroll-button">
                    <button aria-label="Scroll schedule up">↑</button>
                    <button aria-label="Scroll schedule down">↓</button>
                </div>
            </section>

            <section className="DashboardCard TasksCard">
                <h1>Upcoming Tasks</h1>
                <ol>
                    {task.map((item, index) => (
                        <li key={`${item}-${index}`}> {item} </li>
                    ))}
                </ol>
                <div className="scroll-button">
                    <button aria-label="Scroll tasks up">↑</button>
                    <button aria-label="Scroll tasks down">↓</button>
                </div>
            </section>
        </div>

        <section className="DashboardCalendarPanel" aria-label="Calendar">
            <div className="DashboardActions">
                <button
                    className="task-add-trigger"
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={isTaskDialogOpen}
                    onClick={() => {
                        setTaskError("");
                        setIsTaskDialogOpen(true);
                    }}
                >
                    <span aria-hidden="true">+</span> Add task
                </button>
                <button
                    className="task-add-trigger"
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={isScheduleDialogOpen}
                    onClick={() => {
                        setScheduleError("");
                        setIsScheduleDialogOpen(true);
                    }}
                >
                    <span aria-hidden="true">+</span> Add schedule
                </button>
            </div>
            <CalendarWithPresets />
        </section>
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
                            placeholder="Add a task"
                            value={newTask}
                            onChange={(event) => setNewTask(event.target.value)}
                        />
                        <button type="submit" aria-label="Add task">+</button>
                    </form>
                    {taskError && <p className="task-error" role="alert">{taskError}</p>}
                </section>
            </div>
        )}
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
}
