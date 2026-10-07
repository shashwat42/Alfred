const tasks: string[] = [];

export function getTasks() {
    return tasks;
}

export function addTask(task: string) {
    tasks.push(task);
    return task;
}