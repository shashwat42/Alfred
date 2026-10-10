import { FocusTimerDisplay } from "./FocusTimerDisplay.tsx";
import { FocusConfigBar } from "./FocusConfigBar.tsx";
import type { useFocusSession } from "../../hooks/useFocusSession.ts";
import { CheckCircle2, RotateCcw } from "lucide-react";

interface FocusSessionProps {
    todayWeekdayLabel: string;
    todayMonthDayLabel: string;
    onReturnToDashboard: () => void;
    focusSession: ReturnType<typeof useFocusSession>;
}

export function FocusSession({
    todayWeekdayLabel,
    todayMonthDayLabel,
    onReturnToDashboard,
    focusSession,
}: FocusSessionProps) {
    const {
        workMinutes,
        workSeconds,
        setWorkMinutes,
        setWorkSeconds,
        breakMinutes,
        breakSeconds,
        setBreakMinutes,
        setBreakSeconds,
        totalCycles,
        setTotalCycles,
        currentCycle,
        phase,
        isRunning,
        hasStarted,
        remainingSeconds,
        togglePlayPause,
        resetTimer,
    } = focusSession;

    return (
        <div className="focus-session-workspace">
            {/* Top Date Header */}
            <div className="focus-session-top-bar">
                <div className="dashboard-date-banner">
                    <div className="date-banner-text">
                        <span className="date-banner-weekday">{todayWeekdayLabel}</span>
                        <span className="date-banner-day">{todayMonthDayLabel}</span>
                    </div>
                </div>
            </div>

            {/* Main Center Timer Workspace */}
            <div className="focus-session-center-stage">
                {phase === "completed" ? (
                    <div className="focus-completed-card">
                        <div className="focus-completed-icon-wrap">
                            <CheckCircle2 size={48} className="focus-completed-check" />
                        </div>
                        <h2 className="focus-completed-title">Focus Session Complete!</h2>
                        <p className="focus-completed-subtitle">
                            You completed all {totalCycles} Pomodoro cycles. Outstanding focus!
                        </p>
                        <div className="focus-completed-actions">
                            <button
                                type="button"
                                className="focus-completed-restart-btn"
                                onClick={resetTimer}
                            >
                                <RotateCcw size={16} />
                                <span>Start Another Session</span>
                            </button>
                            <button
                                type="button"
                                className="focus-completed-dashboard-btn"
                                onClick={onReturnToDashboard}
                            >
                                Return to Dashboard
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Horizontal Timer Display */}
                        <FocusTimerDisplay
                            workMinutes={workMinutes}
                            workSeconds={workSeconds}
                            setWorkMinutes={setWorkMinutes}
                            setWorkSeconds={setWorkSeconds}
                            breakMinutes={breakMinutes}
                            breakSeconds={breakSeconds}
                            setBreakMinutes={setBreakMinutes}
                            setBreakSeconds={setBreakSeconds}
                            remainingSeconds={remainingSeconds}
                            phase={phase}
                            isRunning={isRunning}
                            hasStarted={hasStarted}
                            togglePlayPause={togglePlayPause}
                            resetTimer={resetTimer}
                        />

                        {/* Unobtrusive Configuration / Progress Bar */}
                        <FocusConfigBar
                            workMinutes={workMinutes}
                            setWorkMinutes={setWorkMinutes}
                            breakMinutes={breakMinutes}
                            setBreakMinutes={setBreakMinutes}
                            totalCycles={totalCycles}
                            setTotalCycles={setTotalCycles}
                            isRunning={isRunning}
                            hasStarted={hasStarted}
                            currentCycle={currentCycle}
                            phase={phase}
                        />
                    </>
                )}
            </div>

            {/* Bottom Dashboard Button */}
            <div className="focus-session-bottom-bar">
                <button
                    type="button"
                    className="focus-dashboard-pill-btn"
                    onClick={onReturnToDashboard}
                    title="Return to Dashboard"
                >
                    Dashboard
                </button>
            </div>
        </div>
    );
}
