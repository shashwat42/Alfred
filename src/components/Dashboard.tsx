import { useEffect, useState } from "react";
import { CalendarWithPresets } from "./ui/calendar-with-presets";

type ScheduleItem = { time: string; topic: string; date: string };
const ITEMS_PER_PAGE = 5;
const PAGE_WINDOW_SIZE = 5;

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

export default function Dashboard() {
    const [selectedDate, setSelectedDate] = useState(() => new Date());
    const scheduleDate = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
    const [schedulePage, setSchedulePage] = useState(0);
    const [task, setTask] = useState<string[]>([]);
    const [taskPage, setTaskPage] = useState(0);
    const [newTask, setNewTask] = useState("");
    const [taskError, setTaskError] = useState("");
    const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
    const [newScheduleTime, setNewScheduleTime] = useState("");
    const [newScheduleTopic, setNewScheduleTopic] = useState("");
    const [newScheduleDate, setNewScheduleDate] = useState(scheduleDate);
    const [scheduleError, setScheduleError] = useState("");
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const schedulePageCount = Math.ceil(schedule.length / ITEMS_PER_PAGE);
    const taskPageCount = Math.ceil(task.length / ITEMS_PER_PAGE);
    const visibleSchedule = schedule.slice(
        schedulePage * ITEMS_PER_PAGE,
        (schedulePage + 1) * ITEMS_PER_PAGE
    );
    const visibleTasks = task.slice(
        taskPage * ITEMS_PER_PAGE,
        (taskPage + 1) * ITEMS_PER_PAGE
    );

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
                const response = await fetch(`http://localhost:8000/api/schedule?date=${scheduleDate}`);
                if (!response.ok) {
                    throw new Error(`Request failed: ${response.status}`);
                }
                const data: ScheduleItem[] = await response.json();
                setSchedule(data);
                setSchedulePage(0);
            } catch (error) {
                console.error("Could not load schedule:", error);
            }
        }

        void loadSchedule();
    }, [scheduleDate]);


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
                body: JSON.stringify({ schedule: { time, topic, date: newScheduleDate } }),
            });
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }

            const data: { schedule: ScheduleItem } = await response.json();
            if (data.schedule.date === scheduleDate) setSchedule((currentSchedule) =>
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
                <div className="DashboardCardHeading">
                    <h1>{scheduleDate === todayDate ? "Today's Schedule" : `${selectedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}'s Schedule`}</h1>
                    <button
                        className="section-add-trigger"
                        type="button"
                        aria-label="Add schedule"
                        aria-haspopup="dialog"
                        aria-expanded={isScheduleDialogOpen}
                        onClick={() => {
                            setScheduleError("");
                            setNewScheduleDate(scheduleDate);
                            setIsScheduleDialogOpen(true);
                        }}
                    >+</button>
                </div>
                <ul className="DashboardCardItems">
                    {visibleSchedule.map((item, index) => (
                        <li
                            key={`${item.time}-${schedulePage * ITEMS_PER_PAGE + index}`}
                            data-full-text={item.topic}
                            onMouseEnter={(event) => {
                                const topic = event.currentTarget.querySelector<HTMLElement>(".schedule-topic");
                                event.currentTarget.dataset.truncated = String(
                                    Boolean(topic && topic.scrollWidth > topic.clientWidth)
                                );
                            }}
                        >
                            <span>{item.time}</span>
                            <span className="schedule-topic">{item.topic}</span>
                        </li>
                    ))}
                </ul>
                <Pagination
                    pageCount={schedulePageCount}
                    currentPage={schedulePage}
                    onPageChange={setSchedulePage}
                    label="Schedule"
                />
            </section>

            <section className="DashboardCard TasksCard">
                <div className="DashboardCardHeading">
                    <h1>Upcoming Tasks</h1>
                    <button
                        className="section-add-trigger"
                        type="button"
                        aria-label="Add task"
                        aria-haspopup="dialog"
                        aria-expanded={isTaskDialogOpen}
                        onClick={() => {
                            setTaskError("");
                            setIsTaskDialogOpen(true);
                        }}
                    >+</button>
                </div>
                <ol className="DashboardCardItems">
                    {visibleTasks.map((item, index) => (
                        <li
                            key={`${item}-${taskPage * ITEMS_PER_PAGE + index}`}
                            data-full-text={item}
                            onMouseEnter={(event) => {
                                const taskText = event.currentTarget.querySelector<HTMLElement>(".task-item-text");
                                event.currentTarget.dataset.truncated = String(
                                    Boolean(taskText && taskText.scrollWidth > taskText.clientWidth)
                                );
                            }}
                        >
                            <span className="task-item-text">{item}</span>
                        </li>
                    ))}
                </ol>
                <Pagination
                    pageCount={taskPageCount}
                    currentPage={taskPage}
                    onPageChange={setTaskPage}
                    label="Task"
                />
            </section>
        </div>

        <section className="DashboardCalendarPanel" aria-label="Calendar">
            <CalendarWithPresets onDateChange={setSelectedDate} />
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
}
