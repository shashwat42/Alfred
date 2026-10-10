import { useState } from "react";
import { formatTimeMMSS } from "../../hooks/useFocusSession.ts";
import { WheelPicker } from "./WheelPicker.tsx";

interface FocusTimerDisplayProps {
    workMinutes: number;
    workSeconds: number;
    setWorkMinutes: (val: number) => void;
    setWorkSeconds: (val: number) => void;
    breakMinutes: number;
    breakSeconds: number;
    setBreakMinutes: (val: number) => void;
    setBreakSeconds: (val: number) => void;
    remainingSeconds: number;
    phase: "work" | "break" | "completed";
    isRunning: boolean;
    hasStarted: boolean;
    togglePlayPause: () => void;
    resetTimer: () => void;
}

export function FocusTimerDisplay({
    workMinutes,
    workSeconds,
    setWorkMinutes,
    setWorkSeconds,
    breakMinutes,
    breakSeconds,
    setBreakMinutes,
    setBreakSeconds,
    remainingSeconds,
    phase,
    isRunning,
    hasStarted,
    togglePlayPause,
    resetTimer,
}: FocusTimerDisplayProps) {
    const [confirmReset, setConfirmReset] = useState(false);

    // Compute display values for active countdown
    const totalWorkSecs = workMinutes * 60 + workSeconds;
    const totalBreakSecs = breakMinutes * 60 + breakSeconds;

    let workDisplay = formatTimeMMSS(totalWorkSecs);
    let breakDisplay = formatTimeMMSS(totalBreakSecs);

    if (phase === "work") {
        workDisplay = formatTimeMMSS(remainingSeconds);
        breakDisplay = formatTimeMMSS(totalBreakSecs);
    } else if (phase === "break") {
        workDisplay = formatTimeMMSS(totalWorkSecs);
        breakDisplay = formatTimeMMSS(remainingSeconds);
    } else if (phase === "completed") {
        workDisplay = "00:00";
        breakDisplay = "00:00";
    }

    const isIdle = !hasStarted && !isRunning;

    const handleResetClick = () => {
        if (!hasStarted) {
            resetTimer();
            return;
        }
        if (confirmReset) {
            resetTimer();
            setConfirmReset(false);
        } else {
            setConfirmReset(true);
        }
    };

    return (
        <div className="focus-timer-container">
            <div className="focus-timer-row">
                {/* Left Column: Work Time */}
                <div className="focus-column focus-col-work">
                    <span className="focus-column-label">Time</span>
                    {isIdle ? (
                        <div className="focus-wheel-container">
                            <WheelPicker
                                value={workMinutes}
                                onChange={setWorkMinutes}
                                min={0}
                                max={90}
                                step={1}
                            />
                            <span className="focus-wheel-colon">:</span>
                            <WheelPicker
                                value={workSeconds}
                                onChange={setWorkSeconds}
                                min={0}
                                max={59}
                                step={1}
                            />
                        </div>
                    ) : (
                        <div className="focus-digit-display">{workDisplay}</div>
                    )}
                </div>

                {/* Center Column: Big Red Circular Play/Pause & RESET button */}
                <div className="focus-center-column">
                    <button
                        type="button"
                        className={`focus-play-circle-btn ${isRunning ? "is-running" : "is-paused"}`}
                        onClick={togglePlayPause}
                        aria-label={isRunning ? "Pause focus session" : "Start focus session"}
                        title={isRunning ? "Pause" : "Play"}
                    >
                        {isRunning ? (
                            <svg
                                className="focus-pause-icon"
                                viewBox="0 0 100 100"
                                fill="#161515"
                                width="100%"
                                height="100%"
                            >
                                <rect x="34" y="28" width="10" height="44" rx="4" />
                                <rect x="56" y="28" width="10" height="44" rx="4" />
                            </svg>
                        ) : (
                            <svg
                                className="focus-play-icon"
                                viewBox="0 0 100 100"
                                fill="#161515"
                                width="100%"
                                height="100%"
                            >
                                <polygon points="38,25 77,50 38,75" />
                            </svg>
                        )}
                    </button>

                    {/* Reset Button */}
                    {confirmReset ? (
                        <div className="focus-reset-confirm-box">
                            <span className="focus-reset-confirm-label">Reset?</span>
                            <button
                                type="button"
                                className="focus-reset-confirm-btn confirm-yes"
                                onClick={() => {
                                    resetTimer();
                                    setConfirmReset(false);
                                }}
                            >
                                Yes
                            </button>
                            <button
                                type="button"
                                className="focus-reset-confirm-btn confirm-no"
                                onClick={() => setConfirmReset(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="focus-reset-pill-btn"
                            onClick={handleResetClick}
                            title="Reset session to start"
                        >
                            RESET
                        </button>
                    )}
                </div>

                {/* Right Column: Break Time (Matching bright colors with Time) */}
                <div className="focus-column focus-col-break">
                    <span className="focus-column-label">Break</span>
                    {isIdle ? (
                        <div className="focus-wheel-container">
                            <WheelPicker
                                value={breakMinutes}
                                onChange={setBreakMinutes}
                                min={0}
                                max={60}
                                step={1}
                            />
                            <span className="focus-wheel-colon">:</span>
                            <WheelPicker
                                value={breakSeconds}
                                onChange={setBreakSeconds}
                                min={0}
                                max={59}
                                step={1}
                            />
                        </div>
                    ) : (
                        <div className="focus-digit-display">{breakDisplay}</div>
                    )}
                </div>
            </div>
        </div>
    );
}
