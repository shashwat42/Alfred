import { notePlainText } from "../../lib/noteText.ts";
import { useState, useMemo, memo, type KeyboardEvent } from "react";
import { Clock } from "lucide-react";
import type { ScheduleItem, TaskItem } from "../../types/dashboard.ts";
import type { NoteItem } from "../../types/notes.ts";
import { getRelativeTimeBadge, parseTimeToMinutes } from "../../utils/scheduleUtils.ts";

const PRIORITY_WEIGHT: Record<string, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
    normal: 0,
};

function UpcomingViewComponent({
    scheduleItems = [],
    priorityTasks = [],
    currentMinutes,
    recentNotes = [],
    hasNotes = recentNotes.length > 0,
    onOpenNote,
    onSaveQuickNote,
}: {
    scheduleItems?: ScheduleItem[];
    priorityTasks?: TaskItem[];
    currentMinutes?: number;
    recentNotes?: NoteItem[];
    hasNotes?: boolean;
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

    const displaySchedule = useMemo(() => {
        return scheduleItems
            .filter((item) => {
                if (currentMinutes === undefined) return true;
                return parseTimeToMinutes(item.time) >= currentMinutes;
            })
            .sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time))
            .slice(0, 5);
    }, [scheduleItems, currentMinutes]);

    // Only show uncompleted tasks with priority higher than "normal", sorted by priority weight descending
    const filteredPriorityTasks = useMemo(() => {
        return priorityTasks
            .filter((t) => !t.completed && t.priority && t.priority !== "normal")
            .sort((a, b) => {
                const weightA = PRIORITY_WEIGHT[a.priority || "normal"] || 0;
                const weightB = PRIORITY_WEIGHT[b.priority || "normal"] || 0;
                return weightB - weightA;
            })
            .slice(0, 5);
    }, [priorityTasks]);

    const isEmpty = displaySchedule.length === 0 && priorityTasks.length === 0 && !hasNotes;

    return (
        <div className="upcoming-view-container">
            <div className="upcoming-scrollable-content">
                {isEmpty ? <div className="upcoming-all-empty" role="status">
                    <span className="empty-text-art" aria-hidden="true">( ˘ᴗ˘ )</span>
                    <span>Nothing to show here :)</span>
                </div> : <>
                <div className="upcoming-columns-grid">
                    {/* Schedule Column */}
                    <div className="upcoming-col">
                        <h3 className="upcoming-col-header">Schedule</h3>
                        <div className="upcoming-col-list">
                            {displaySchedule.length > 0 ? (
                                displaySchedule.map((item, index) => {
                                    const isNextUp = index === 0;
                                    const relTime =
                                        currentMinutes !== undefined
                                            ? getRelativeTimeBadge(parseTimeToMinutes(item.time), currentMinutes)
                                            : null;

                                    return (
                                        <div
                                            key={item._id || `${item.time}-${item.topic}-${index}`}
                                            className={`upcoming-schedule-card ${isNextUp ? "is-next-up" : "is-compact"}`}
                                        >
                                            <div className="upcoming-schedule-card-left">
                                                <span className={`upcoming-schedule-card-time ${isNextUp ? "is-next-up" : ""}`}>
                                                    <Clock size={isNextUp ? 12 : 11} className="upcoming-schedule-clock-icon" />
                                                    {item.time}
                                                </span>
                                                <span
                                                    className={`upcoming-schedule-card-topic ${isNextUp ? "is-next-up" : ""}`}
                                                    title={item.topic}
                                                >
                                                    {item.topic}
                                                </span>
                                            </div>
                                            {relTime && (
                                                <span className={`upcoming-schedule-rel-badge ${isNextUp ? "is-next-up" : ""}`}>
                                                    {relTime}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="upcoming-empty-hint" role="status"><span className="empty-text-art" aria-hidden="true">( ˘ᴗ˘ )</span><span>No upcoming schedules</span></div>
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
                                        className="upcoming-task-card"
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
                                <div className="upcoming-empty-hint" role="status"><span className="empty-text-art" aria-hidden="true">( •ᴗ• )</span><span>No priority tasks</span></div>
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
                                const cleanPreview = notePlainText(note.content || "").split("\n").slice(0, 3).join("\n");

                                return (
                                    <div
                                        key={note._id}
                                        className="upcoming-recent-note-card"
                                        onClick={() => onOpenNote?.(note)}
                                        title={`Open ${displayTitle}`}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Open note: ${displayTitle}`}
                                        onKeyDown={(event) => {
                                            if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                                event.preventDefault();
                                                onOpenNote?.(note);
                                            }
                                        }}
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
                                <span className="empty-text-art" aria-hidden="true">( •◡• )</span><span>No recently opened notes</span>
                            </div>
                        )}
                    </div>
                </div>
                </>}
            </div>

            {/* Bottom Notes Quick Bar */}
            <div className="upcoming-notes-bar">
                <label className="upcoming-notes-tag" htmlFor="upcoming-quick-note">notes</label>
                <input
                    id="upcoming-quick-note"
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

export const UpcomingView = memo(UpcomingViewComponent);
