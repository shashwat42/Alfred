import { useState } from "react";
import { Minus, Plus } from "lucide-react";

interface FocusConfigBarProps {
    workMinutes: number;
    setWorkMinutes: (val: number) => void;
    breakMinutes: number;
    setBreakMinutes: (val: number) => void;
    totalCycles: number;
    setTotalCycles: (val: number) => void;
    isRunning?: boolean;
    hasStarted: boolean;
    currentCycle: number;
    phase: "work" | "break" | "completed";
}

export function FocusConfigBar({
    workMinutes,
    setWorkMinutes,
    breakMinutes,
    setBreakMinutes,
    totalCycles,
    setTotalCycles,
    hasStarted,
    currentCycle,
    phase,
}: FocusConfigBarProps) {
    const [isEditingWork, setIsEditingWork] = useState(false);
    const [workInput, setWorkInput] = useState(String(workMinutes));

    const [isEditingBreak, setIsEditingBreak] = useState(false);
    const [breakInput, setBreakInput] = useState(String(breakMinutes));

    const [isEditingCycles, setIsEditingCycles] = useState(false);
    const [cyclesInput, setCyclesInput] = useState(String(totalCycles));

    if (hasStarted) {
        return (
            <div className="focus-progress-bar-container">
                <div className="focus-cycle-badge">
                    <span className="focus-cycle-text">
                        Cycle {Math.min(currentCycle, totalCycles)} of {totalCycles}
                    </span>
                    <span className="focus-phase-indicator">
                        {phase === "work" ? "• Focus" : phase === "break" ? "• Break" : "• Finished"}
                    </span>
                </div>
                <div className="focus-cycle-dots">
                    {Array.from({ length: totalCycles }, (_, i) => {
                        const cycleNum = i + 1;
                        const isPast = cycleNum < currentCycle;
                        const isCurrent = cycleNum === currentCycle;
                        return (
                            <span
                                key={cycleNum}
                                className={`focus-cycle-dot ${
                                    isCurrent ? (phase === "work" ? "active-work" : "active-break") : isPast ? "completed" : ""
                                }`}
                                title={`Cycle ${cycleNum}`}
                            />
                        );
                    })}
                </div>
            </div>
        );
    }

    const commitWork = () => {
        const num = parseInt(workInput, 10);
        if (!isNaN(num) && num > 0) {
            setWorkMinutes(Math.min(120, Math.max(1, num)));
        }
        setIsEditingWork(false);
    };

    const commitBreak = () => {
        const num = parseInt(breakInput, 10);
        if (!isNaN(num) && num >= 0) {
            setBreakMinutes(Math.min(60, Math.max(0, num)));
        }
        setIsEditingBreak(false);
    };

    const commitCycles = () => {
        const num = parseInt(cyclesInput, 10);
        if (!isNaN(num) && num > 0) {
            setTotalCycles(Math.min(24, Math.max(1, num)));
        }
        setIsEditingCycles(false);
    };

    return (
        <div className="focus-config-strip">
            {/* Work Duration Stepper with click-to-edit custom input */}
            <div className="focus-config-stepper">
                <span className="focus-config-label">Work</span>
                <div className="focus-stepper-control">
                    <button
                        type="button"
                        className="focus-stepper-btn"
                        onClick={() => setWorkMinutes(Math.max(1, workMinutes - 5))}
                        title="Decrease work duration by 5m"
                    >
                        <Minus size={13} />
                    </button>
                    {isEditingWork ? (
                        <input
                            type="number"
                            className="focus-stepper-input"
                            autoFocus
                            min={1}
                            max={120}
                            value={workInput}
                            onChange={(e) => setWorkInput(e.target.value)}
                            onBlur={commitWork}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitWork();
                                if (e.key === "Escape") setIsEditingWork(false);
                            }}
                        />
                    ) : (
                        <span
                            className="focus-stepper-val is-clickable"
                            onClick={() => {
                                setWorkInput(String(workMinutes));
                                setIsEditingWork(true);
                            }}
                            title="Click to type custom minutes"
                        >
                            {workMinutes}m
                        </span>
                    )}
                    <button
                        type="button"
                        className="focus-stepper-btn"
                        onClick={() => setWorkMinutes(Math.min(90, workMinutes + 5))}
                        title="Increase work duration by 5m"
                    >
                        <Plus size={13} />
                    </button>
                </div>
            </div>

            <div className="focus-config-divider" />

            {/* Break Duration Stepper with click-to-edit custom input */}
            <div className="focus-config-stepper">
                <span className="focus-config-label">Break</span>
                <div className="focus-stepper-control">
                    <button
                        type="button"
                        className="focus-stepper-btn"
                        onClick={() => setBreakMinutes(Math.max(0, breakMinutes - 1))}
                        title="Decrease break duration by 1m"
                    >
                        <Minus size={13} />
                    </button>
                    {isEditingBreak ? (
                        <input
                            type="number"
                            className="focus-stepper-input"
                            autoFocus
                            min={0}
                            max={60}
                            value={breakInput}
                            onChange={(e) => setBreakInput(e.target.value)}
                            onBlur={commitBreak}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitBreak();
                                if (e.key === "Escape") setIsEditingBreak(false);
                            }}
                        />
                    ) : (
                        <span
                            className="focus-stepper-val is-clickable"
                            onClick={() => {
                                setBreakInput(String(breakMinutes));
                                setIsEditingBreak(true);
                            }}
                            title="Click to type custom minutes"
                        >
                            {breakMinutes}m
                        </span>
                    )}
                    <button
                        type="button"
                        className="focus-stepper-btn"
                        onClick={() => setBreakMinutes(Math.min(30, breakMinutes + 1))}
                        title="Increase break duration by 1m"
                    >
                        <Plus size={13} />
                    </button>
                </div>
            </div>

            <div className="focus-config-divider" />

            {/* Cycles Stepper with click-to-edit */}
            <div className="focus-config-stepper">
                <span className="focus-config-label">Cycles</span>
                <div className="focus-stepper-control">
                    <button
                        type="button"
                        className="focus-stepper-btn"
                        onClick={() => setTotalCycles(Math.max(1, totalCycles - 1))}
                        title="Decrease cycles"
                    >
                        <Minus size={13} />
                    </button>
                    {isEditingCycles ? (
                        <input
                            type="number"
                            className="focus-stepper-input"
                            autoFocus
                            min={1}
                            max={24}
                            value={cyclesInput}
                            onChange={(e) => setCyclesInput(e.target.value)}
                            onBlur={commitCycles}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitCycles();
                                if (e.key === "Escape") setIsEditingCycles(false);
                            }}
                        />
                    ) : (
                        <span
                            className="focus-stepper-val is-clickable"
                            onClick={() => {
                                setCyclesInput(String(totalCycles));
                                setIsEditingCycles(true);
                            }}
                            title="Click to type custom cycles"
                        >
                            {totalCycles}
                        </span>
                    )}
                    <button
                        type="button"
                        className="focus-stepper-btn"
                        onClick={() => setTotalCycles(Math.min(12, totalCycles + 1))}
                        title="Increase cycles"
                    >
                        <Plus size={13} />
                    </button>
                </div>
            </div>

            <div className="focus-config-divider" />

            {/* Quick Presets */}
            <div className="focus-config-presets">
                <button
                    type="button"
                    className={`focus-preset-pill ${workMinutes === 25 && breakMinutes === 5 ? "active" : ""}`}
                    onClick={() => {
                        setWorkMinutes(25);
                        setBreakMinutes(5);
                    }}
                >
                    25/5
                </button>
                <button
                    type="button"
                    className={`focus-preset-pill ${workMinutes === 50 && breakMinutes === 10 ? "active" : ""}`}
                    onClick={() => {
                        setWorkMinutes(50);
                        setBreakMinutes(10);
                    }}
                >
                    50/10
                </button>
            </div>
        </div>
    );
}
