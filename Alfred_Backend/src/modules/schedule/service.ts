export type ScheduleItem = { time: string; topic: string; date?: string };
const now = new Date();
function demoDate(index: number) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.floor(index / 10));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const schedules: ScheduleItem[] = ([{ time: "08:00", topic: "Wake up" },
{ time: "08:15", topic: "Morning exercise" },
{ time: "08:30", topic: "Take a shower" },
{ time: "08:45", topic: "Have breakfast" },
{ time: "09:00", topic: "Check emails" },
{ time: "09:15", topic: "Plan the day" },
{ time: "09:30", topic: "Learn TypeScript" },
{ time: "09:45", topic: "Practice JavaScript" },
{ time: "10:00", topic: "Work on backend" },
{ time: "10:15", topic: "Build API endpoints" },
{ time: "10:30", topic: "Test API" },
{ time: "10:45", topic: "Fix bugs" },
{ time: "11:00", topic: "Code review" },
{ time: "11:15", topic: "Database work" },
{ time: "11:30", topic: "Write SQL queries" },
{ time: "11:45", topic: "Study PostgreSQL" },
{ time: "12:00", topic: "Take a break" },
{ time: "12:15", topic: "Read documentation" },
{ time: "12:30", topic: "Work on project" },
{ time: "12:45", topic: "Implement a feature" },
{ time: "13:00", topic: "Have lunch" },
{ time: "13:30", topic: "Relax" },
{ time: "14:00", topic: "Continue development" },
{ time: "14:15", topic: "Write TypeScript types" },
{ time: "14:30", topic: "Practice React" },
{ time: "14:45", topic: "Build UI components" },
{ time: "15:00", topic: "Work with APIs" },
{ time: "15:15", topic: "Test frontend" },
{ time: "15:30", topic: "Fix UI bugs" },
{ time: "15:45", topic: "Git commit" },
{ time: "16:00", topic: "Push changes" },
{ time: "16:15", topic: "Review progress" },
{ time: "16:30", topic: "Study system design" },
{ time: "16:45", topic: "Practice DSA" },
{ time: "17:00", topic: "Solve coding problems" },
{ time: "17:15", topic: "Take a break" },
{ time: "17:30", topic: "Go for a walk" },
{ time: "17:45", topic: "Have a snack" },
{ time: "18:00", topic: "Work on personal project" },
{ time: "18:30", topic: "Learn Node.js" },
{ time: "19:00", topic: "Practice Express.js" },
{ time: "19:30", topic: "Have dinner" },
{ time: "20:00", topic: "Watch a movie" },
{ time: "20:30", topic: "Play a game" },
{ time: "21:00", topic: "Read a book" },
{ time: "21:30", topic: "Plan tomorrow" },
{ time: "22:00", topic: "Review today's work" },
{ time: "22:30", topic: "Relax" },
{ time: "23:00", topic: "Get ready for bed" },
{ time: "23:30", topic: "Sleep" }]).map((item, index) => ({ ...item, date: demoDate(index) }));

export function getSchedule(date: string) {
    return schedules.filter((item) => item.date === date);
}

export function addSchedule(schedule: ScheduleItem) {
    schedules.push(schedule)
}
