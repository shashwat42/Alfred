import type { DashboardView } from "../../types/dashboard.ts";
import scheduleIcon from "../../assets/schedule.png";
import mailIcon from "../../assets/mail.png";
import todoIcon from "../../assets/bookmark_filled.png";

export function DashboardNav({
    activeView,
    handleViewChange,
}: {
    activeView: DashboardView;
    handleViewChange: (view: DashboardView) => void;
}) {
    return (
        <nav className="dashboard-nav-strip" aria-label="Dashboard sections">
            <button
                type="button"
                className={`nav-strip-btn ${activeView === "schedule" ? "active" : ""}`}
                onClick={() => handleViewChange(activeView === "schedule" ? "home" : "schedule")}
                aria-label="Schedule"
                title="Schedule"
            >
                <div className="nav-strip-icon-box">
                    <img src={scheduleIcon} alt="" className="nav-strip-icon" />
                </div>
                <span className="nav-strip-label">Schedule</span>
            </button>

            <button
                type="button"
                className={`nav-strip-btn ${activeView === "mails" ? "active" : ""}`}
                onClick={() => handleViewChange(activeView === "mails" ? "home" : "mails")}
                aria-label="Mails"
                title="Mails"
            >
                <div className="nav-strip-icon-box">
                    <img src={mailIcon} alt="" className="nav-strip-icon" />
                </div>
                <span className="nav-strip-label">Mails</span>
            </button>

            <button
                type="button"
                className={`nav-strip-btn ${activeView === "todo" ? "active" : ""}`}
                onClick={() => handleViewChange(activeView === "todo" ? "home" : "todo")}
                aria-label="To-Do"
                title="To-Do"
            >
                <div className="nav-strip-icon-box">
                    <img src={todoIcon} alt="" className="nav-strip-icon" />
                </div>
                <span className="nav-strip-label">To-Do</span>
            </button>
        </nav>
    );
}
