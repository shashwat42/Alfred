import { useState, type KeyboardEvent } from "react";
import type { ScheduleItem, TaskItem } from "../../types/dashboard.ts";
import type { NoteItem } from "../../types/notes.ts";
import { parseTimeToMinutes } from "../../utils/scheduleUtils.ts";

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
    currentMinutes,
    recentNotes = [],
    onOpenNote,
    onSaveQuickNote,
}: {
    scheduleItems?: ScheduleItem[];
    priorityTasks?: TaskItem[];
    currentMinutes?: number;
    recentNotes?: NoteItem[];
    onOpenNote?: (note: NoteItem) => void;
    onSaveQuickNote?: (text: string) => Promise<void>;
}) {
    const [noteText, setNoteText] = useState("");

    const handleNoteKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && noteText.trim()) {
            const textToSave = noteText.trim();
            setNoteText("");
            if (onSaveQuickNote) {
                await onSaveQuickNote(textToSave);
            } else {
                try {
                    const existing = JSON.parse(localStorage.getItem("alfred_quick_notes") || "[]");
                    existing.unshift({
                        text: textToSave,
                        createdAt: new Date().toISOString(),
                    });
                    localStorage.setItem("alfred_quick_notes", JSON.stringify(existing.slice(0, 50)));
                } catch {
                    // Ignore localStorage errors
                }
            }
        }
    };

    const displaySchedule = scheduleItems
        .filter((item) => {
            if (currentMinutes === undefined) return true;
            return parseTimeToMinutes(item.time) >= currentMinutes;
        })
        .sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time))
        .slice(0, 5);

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
                            <div className="upcoming-empty-hint">No upcoming events scheduled today</div>
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

            {/* Recently Opened Notes Cards (Limit of 4, above the notes input bar) */}
            <div className="upcoming-recent-notes-container">
                <h3 className="upcoming-recent-notes-heading">Recently viewed</h3>
                <div className="upcoming-recent-notes-grid">
                    {recentNotes.length > 0 ? (
                        recentNotes.slice(0, 4).map((note) => {
                            const displayTitle = note.title.trim() || "No title";
                            const dateStr = note.lastOpenedAt || note.updatedAt || note.createdAt;
                            const formattedDate = dateStr
                                ? new Date(dateStr).toLocaleDateString("en-US", { day: "numeric", month: "short" })
                                : "";
                            const cleanPreview = (note.content || "")
                                .replace(/<br\s*\/?>/gi, " ")
                                .replace(/<\/?[^>]+(>|$)/g, " ")
                                .replace(/\*\*/g, "")
                                .replace(/\*/g, "")
                                .replace(/\s+/g, " ")
                                .trim();

                            return (
                                <div
                                    key={note._id}
                                    className="upcoming-recent-note-card"
                                    onClick={() => onOpenNote?.(note)}
                                    title={`Open ${displayTitle}`}
                                >
                                    <div className="recent-note-preview-box">
                                        <p className="recent-note-preview-text">
                                            {cleanPreview || "Empty note"}
                                        </p>
                                    </div>
                                    <div className="recent-note-card-meta">
                                        <span className="recent-note-title" title={displayTitle}>
                                            {displayTitle}
                                        </span>
                                        <span className="recent-note-date">{formattedDate}</span>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="upcoming-recent-notes-empty">
                            <span>No recently opened notes</span>
                        </div>
                    )}
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
