import type { ScheduleItem } from "../../types/dashboard.ts";
import { EVENT_PALETTE, getRelativeTimeBadge, parseTimeToMinutes } from "../../utils/scheduleUtils.ts";

export function UpcomingView({
    upcomingTop3,
    currentMinutes,
}: {
    upcomingTop3: ScheduleItem[];
    currentMinutes: number;
}) {
    return (
        <div className="upcoming-section-wrapper">
            {upcomingTop3.length > 0 ? (
                <div className="upcoming-cards-container">
                    {upcomingTop3.map((item, index) => {
                        const mins = parseTimeToMinutes(item.time);
                        const badge = getRelativeTimeBadge(mins, currentMinutes);
                        const palette = EVENT_PALETTE[index % EVENT_PALETTE.length];
                        return (
                            <article
                                key={item._id || `${item.time}-${item.topic}`}
                                className="upcoming-item-card"
                                style={{ borderLeftColor: palette.border }}
                            >
                                <div className="upcoming-card-top">
                                    <span className="upcoming-card-time">{item.time}</span>
                                    <span
                                        className="upcoming-card-badge"
                                        style={{
                                            backgroundColor: palette.bg,
                                            color: palette.text,
                                            borderColor: palette.border,
                                        }}
                                    >
                                        {badge}
                                    </span>
                                </div>
                                <h3 className="upcoming-card-topic" title={item.topic}>
                                    {item.topic}
                                </h3>
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="upcoming-empty-card">
                    <div className="upcoming-empty-icon">✓</div>
                    <p className="upcoming-empty-text">No upcoming tasks remaining for today.</p>
                </div>
            )}
        </div>
    );
}
