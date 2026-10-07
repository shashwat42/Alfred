type ScheduleItem = { time: string; topic: string };
const schedules: ScheduleItem[] = [];

export function getSchedule() {
    return schedules;
}

export function addSchedule(schedule: ScheduleItem) {
    schedules.push(schedule)
}