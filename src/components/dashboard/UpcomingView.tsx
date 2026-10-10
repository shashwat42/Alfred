import { useState, type KeyboardEvent } from "react";
import type { ScheduleItem, TaskItem } from "../../types/dashboard.ts";

const PRIORITY_WEIGHT: Record<string, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
    normal: 0,
};

export function UpcomingView({
    scheduleItems = [],
    priorityTasks = [],
}: {
    scheduleItems?: ScheduleItem[];
    priorityTasks?: TaskItem[];
    currentMinutes?: number;
}) {
    const [noteText, setNoteText] = useState("");

    const handleNoteKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && noteText.trim()) {
            try {
                const existing = JSON.parse(localStorage.getItem("alfred_quick_notes") || "[]");
                existing.unshift({
                    text: noteText.trim(),
                    createdAt: new Date().toISOString(),
                });
                localStorage.setItem("alfred_quick_notes", JSON.stringify(existing.slice(0, 50)));
            } catch {
                // Ignore localStorage errors
            }
            setNoteText("");
        }
    };

    const displaySchedule = scheduleItems.slice(0, 5);

    // Only show uncompleted tasks with priority higher than "normal", sorted by priority weight descending
    const filteredPriorityTasks = priorityTasks
        .filter((t) => !t.completed && t.priority && t.priority !== "normal")
        .sort((a, b) => {
            const weightA = PRIORITY_WEIGHT[a.priority || "normal"] || 0;
            const weightB = PRIORITY_WEIGHT[b.priority || "normal"] || 0;
            return weightB - weightA;
        })
        .slice(0, 5);

    return (
        <div className="upcoming-view-container">
            <div className="upcoming-columns-grid">
                {/* Schedule Column */}
                <div className="upcoming-col">
                    <h3 className="upcoming-col-header">Schedule</h3>
                    <div className="upcoming-col-list">
                        {displaySchedule.length > 0 ? (
                            displaySchedule.map((item, index) => (
                                <div
                                    key={item._id || `${item.time}-${item.topic}-${index}`}
                                    className="upcoming-schedule-row"
                                >
                                    <span className="upcoming-schedule-time">{item.time}</span>
                                    <span className="upcoming-schedule-topic" title={item.topic}>
                                        {item.topic}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div className="upcoming-empty-hint">No events scheduled today</div>
                        )}
                    </div>
                </div>

                {/* Priority Tasks Column */}
                <div className="upcoming-col">
                    <h3 className="upcoming-col-header">Priority Tasks</h3>
                    <div className="upcoming-col-list">
                        {filteredPriorityTasks.length > 0 ? (
                            filteredPriorityTasks.map((t, index) => (
                                <div
                                    key={t._id || `${t.task}-${index}`}
                                    className="upcoming-task-row"
                                >
                                    <span className="upcoming-task-text" title={t.task}>
                                        {t.task}
                                    </span>
                                    {t.priority && (
                                        <span className={`upcoming-priority-tag priority-${t.priority}`}>
                                            {t.priority}
                                        </span>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="upcoming-empty-hint">No priority tasks</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Notes Quick Bar */}
            <div className="upcoming-notes-bar">
                <span className="upcoming-notes-tag">notes</span>
                <input
                    type="text"
                    className="upcoming-notes-input"
                    placeholder="Capture an idea or reminder..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={handleNoteKeyDown}
                />
            </div>
        </div>
    );
}
