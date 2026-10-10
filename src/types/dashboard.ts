export type DashboardView = "home" | "schedule" | "tasks" | "notes" | "todo" | "mails";

export type ScheduleItem = {
    _id?: string;
    time: string;
    topic: string;
    date: string;
};

export type TaskPriority = "urgent" | "high" | "medium" | "normal" | "low";

export type TaskItem = {
    _id: string;
    task: string;
    completed?: boolean;
    priority?: TaskPriority;
    createdAt?: string;
    updatedAt?: string;
};
