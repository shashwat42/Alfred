import type { DashboardView } from "../../types/dashboard.ts";

export function DashboardNav({
    activeView,
    handleViewChange,
}: {
    activeView: DashboardView;
    handleViewChange: (view: DashboardView) => void;
}) {
    const isScheduleActive = activeView === "schedule";
    const isNotesActive = activeView === "notes" || activeView === "mails";
    const isTasksActive = activeView === "tasks" || activeView === "todo";

    return (
        <nav className="dashboard-nav-strip" aria-label="Dashboard sections">
            <button
                type="button"
                className={`nav-strip-btn ${isScheduleActive ? "active" : ""}`}
                onClick={() => handleViewChange(isScheduleActive ? "home" : "schedule")}
                aria-label="Schedule"
                title="Schedule"
            >
                <div className="nav-strip-icon-box">
                    <svg
                        className="nav-strip-svg-icon"
                        viewBox="0 0 44 44"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* Calendar frame */}
                        <rect x="5" y="7" width="34" height="32" rx="5" stroke="currentColor" strokeWidth="2.8" />
                        {/* Top binding rings */}
                        <line x1="13" y1="3" x2="13" y2="9" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
                        <line x1="22" y1="3" x2="22" y2="9" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
                        <line x1="31" y1="3" x2="31" y2="9" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
                        {/* Calendar grid dots/boxes */}
                        <rect x="11" y="16" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="17" y="16" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="23" y="16" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="29" y="16" width="3" height="3" rx="0.8" fill="currentColor" />

                        <rect x="11" y="23" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="17" y="23" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="23" y="23" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="29" y="23" width="3" height="3" rx="0.8" fill="currentColor" />

                        <rect x="11" y="30" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="17" y="30" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="23" y="30" width="3" height="3" rx="0.8" fill="currentColor" />
                        <rect x="29" y="30" width="3" height="3" rx="0.8" fill="currentColor" />
                    </svg>
                </div>
                <span className="nav-strip-label">Schedule</span>
            </button>

            <button
                type="button"
                className={`nav-strip-btn ${isNotesActive ? "active" : ""}`}
                onClick={() => handleViewChange(isNotesActive ? "home" : "notes")}
                aria-label="Notes"
                title="Notes"
            >
                <div className="nav-strip-icon-box">
                    <svg
                        className="nav-strip-svg-icon"
                        viewBox="0 0 44 44"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* Back memo sheet */}
                        <path
                            d="M8 12 C8 10.5 9 9.5 10.5 9.5 L28 9.5 L33 34 L12 34 C9.5 34 8 32.5 8 30 Z"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinejoin="round"
                        />
                        {/* Front memo sheet */}
                        <rect
                            x="11"
                            y="14"
                            width="25"
                            height="24"
                            rx="2"
                            fill="#1e1e1e"
                            stroke="currentColor"
                            strokeWidth="2.6"
                        />
                        {/* Lines on front sheet */}
                        <line x1="16" y1="20" x2="31" y2="20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                        <line x1="16" y1="26" x2="31" y2="26" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                        <line x1="16" y1="32" x2="26" y2="32" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                        {/* Pushpin at top */}
                        <ellipse cx="28" cy="7" rx="3.5" ry="3" fill="currentColor" />
                        <line x1="28" y1="9" x2="27" y2="15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                </div>
                <span className="nav-strip-label">Notes</span>
            </button>

            <button
                type="button"
                className={`nav-strip-btn ${isTasksActive ? "active" : ""}`}
                onClick={() => handleViewChange(isTasksActive ? "home" : "tasks")}
                aria-label="Tasks"
                title="Tasks"
            >
                <div className="nav-strip-icon-box">
                    <svg
                        className="nav-strip-svg-icon"
                        viewBox="0 0 44 44"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <rect x="4" y="6" width="36" height="32" rx="6" stroke="currentColor" strokeWidth="2.8" />
                        {/* Check 1 */}
                        <path d="M10 17 L13 20 L19 14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="23" y1="17" x2="33" y2="17" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                        {/* Check 2 */}
                        <path d="M10 27 L13 30 L19 24" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="23" y1="27" x2="33" y2="27" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                    </svg>
                </div>
                <span className="nav-strip-label">Tasks</span>
            </button>
        </nav>
    );
}
