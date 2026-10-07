import { CalendarWithPresets } from "./ui/calendar-with-presets";

const schedule = [
    { time: "10:00", topic: "Team meeting" },
    { time: "12:30", topic: "Lunch" },
    { time: "15:00", topic: "Project work" },
    { time: "18:00", topic: "Meeting" },
    { time: "21:00", topic: "Shift" },
];

const tasks = [
    "Wash the dog", "Do laundry"
]

export default function Dashboard() {
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
                    {tasks.map((item) => (
                        <li> {item} </li>
                    ))}
                </ol>
                <div className="scroll-button">
                    <button aria-label="Scroll tasks up">↑</button>
                    <button aria-label="Scroll tasks down">↓</button>
                </div>
            </section>
        </div>

        <section className="DashboardCalendarPanel" aria-label="Calendar">
            <CalendarWithPresets />
        </section>
    </section>
}
