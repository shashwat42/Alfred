export type DashboardView = "home" | "schedule" | "todo" | "mails";

export type ScheduleItem = {
    _id?: string;
    time: string;
    topic: string;
    date: string;
};

export type TaskItem = {
    _id: string;
    task: string;
    completed?: boolean;
    createdAt?: string;
    updatedAt?: string;
};
