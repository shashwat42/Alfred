import React from "react";
import type { ScheduleItem } from "../../types/dashboard.ts";
import { EVENT_PALETTE, parseTimeToMinutes, TIMELINE_HOURS } from "../../utils/scheduleUtils.ts";

export function ScheduleTimelineView({
    activeTimelineSchedule,
    scheduleDate,
    todayDateStr,
    currentMinutes,
    currentHourRef,
    handleDeleteSchedule,
}: {
    activeTimelineSchedule: ScheduleItem[];
    scheduleDate: string;
    todayDateStr: string;
    /** Total minutes since midnight for the current time (hours * 60 + minutes). */
    currentMinutes: number;
    currentHourRef: React.MutableRefObject<HTMLDivElement | null>;
    handleDeleteSchedule: (id: string) => void;
}) {
    const currentHour = Math.floor(currentMinutes / 60);
    // Minutes within the current hour, used to position the "now" indicator line.
    const nowOffsetPercent = (currentMinutes % 60 / 60) * 100;

    return (
        <div className="schedule-timeline-container">
            <div className="timeline-grid">
                {TIMELINE_HOURS.map((hour) => {
                    const hourLabel =
                        hour === 0
                            ? "12 AM"
                            : hour === 12
                            ? "12 PM"
                            : hour > 12
                            ? `${hour - 12} PM`
                            : `${hour} AM`;

                    const hourEvents = activeTimelineSchedule.filter((item) => {
                        const mins = parseTimeToMinutes(item.time);
                        return Math.floor(mins / 60) === hour;
                    });

                    const isCurrentHour =
                        scheduleDate === todayDateStr && currentHour === hour;

                    return (
                        <div
                            key={hour}
                            className="timeline-hour-row"
                            ref={isCurrentHour ? currentHourRef : undefined}
                        >
                            <div className="timeline-hour-label">{hourLabel}</div>
                            <div className="timeline-hour-slot">
                                {isCurrentHour && (
                                    <div
                                        className="timeline-now-line"
                                        style={{ top: `${nowOffsetPercent}%` }}
                                    >
                                        <span className="timeline-now-dot" />
                                    </div>
                                )}

                                <div className="timeline-events-track">
                                    {hourEvents.map((eventItem, evIdx) => {
                                        const palette =
                                            EVENT_PALETTE[evIdx % EVENT_PALETTE.length];
                                        return (
                                            <div
                                                key={eventItem._id || `${hour}-${evIdx}`}
                                                className="timeline-event-chip"
                                                style={{
                                                    backgroundColor: palette.bg,
                                                    borderColor: palette.border,
                                                    color: palette.text,
                                                }}
                                            >
                                                <span className="timeline-chip-time">
                                                    {eventItem.time}
                                                </span>
                                                <span
                                                    className="timeline-chip-topic"
                                                    title={eventItem.topic}
                                                >
                                                    {eventItem.topic}
                                                </span>
                                                {eventItem._id && (
                                                    <button
                                                        type="button"
                                                        className="timeline-chip-del"
                                                        aria-label={`Remove ${eventItem.topic}`}
                                                        onClick={() => handleDeleteSchedule(eventItem._id!)}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
