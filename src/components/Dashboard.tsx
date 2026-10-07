import { useEffect, useState } from "react";
import { CalendarWithPresets } from "./ui/calendar-with-presets";

type ScheduleItem = { time: string; topic: string };

const tasks = [
    "Wash the dog", "Do laundry"
]

export default function Dashboard() {
    const [schedule, setSchedule] = useState<ScheduleItem[]>([]);

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
