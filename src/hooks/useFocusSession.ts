import { useState, useEffect, useRef, useCallback } from "react";

export type FocusPhase = "work" | "break" | "completed";

export interface FocusSessionState {
    workMinutes: number;
    workSeconds: number;
    breakMinutes: number;
    breakSeconds: number;
    totalCycles: number;
    currentCycle: number;
    phase: FocusPhase;
    isRunning: boolean;
    remainingSeconds: number;
    hasStarted: boolean;
}

/** Plays a gentle, pleasant chime using the Web Audio API without external assets. */
function playChime(type: "phase" | "complete" = "phase") {
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        if (type === "complete") {
            const notes = [523.25, 659.25, 783.99];
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.value = freq;
                const startTime = ctx.currentTime + idx * 0.16;
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.2, startTime + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + 0.55);
            });
        } else {
            [880, 1318.51].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.value = freq;
                const startTime = ctx.currentTime + idx * 0.12;
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + 0.5);
            });
        }
    } catch {
        // Ignore audio playback errors if audio context blocked
    }
}

export function formatTimeMMSS(totalSeconds: number): string {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const mins = Math.floor(clamped / 60);
    const secs = clamped % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function useFocusSession() {
    const [workMinutes, setWorkMinutes] = useState(25);
    const [workSeconds, setWorkSeconds] = useState(0);
    const [breakMinutes, setBreakMinutes] = useState(5);
    const [breakSeconds, setBreakSeconds] = useState(0);
    const [totalCycles, setTotalCycles] = useState(4);
    const [currentCycle, setCurrentCycle] = useState(1);
    const [phase, setPhase] = useState<FocusPhase>("work");
    const [isRunning, setIsRunning] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);

    const targetEndTimeRef = useRef<number | null>(null);

    const getTotalWorkSeconds = useCallback((m: number, s: number) => {
        return Math.max(1, m * 60 + s);
    }, []);

    const getTotalBreakSeconds = useCallback((m: number, s: number) => {
        return Math.max(0, m * 60 + s);
    }, []);

    // Keep remainingSeconds in sync if session hasn't started
    const handleSetWorkMinutes = useCallback((newWork: number) => {
        const val = Math.max(0, Math.min(120, newWork));
        setWorkMinutes(val);
        if (!hasStarted && phase === "work") {
            setRemainingSeconds(getTotalWorkSeconds(val, workSeconds));
        }
    }, [hasStarted, phase, workSeconds, getTotalWorkSeconds]);

    const handleSetWorkSeconds = useCallback((newSecs: number) => {
        const val = Math.max(0, Math.min(59, newSecs));
        setWorkSeconds(val);
        if (!hasStarted && phase === "work") {
            setRemainingSeconds(getTotalWorkSeconds(workMinutes, val));
        }
    }, [hasStarted, phase, workMinutes, getTotalWorkSeconds]);

    const handleSetBreakMinutes = useCallback((newBreak: number) => {
        const val = Math.max(0, Math.min(60, newBreak));
        setBreakMinutes(val);
        if (!hasStarted && phase === "break") {
            setRemainingSeconds(getTotalBreakSeconds(val, breakSeconds));
        }
    }, [hasStarted, phase, breakSeconds, getTotalBreakSeconds]);

    const handleSetBreakSeconds = useCallback((newSecs: number) => {
        const val = Math.max(0, Math.min(59, newSecs));
        setBreakSeconds(val);
        if (!hasStarted && phase === "break") {
            setRemainingSeconds(getTotalBreakSeconds(breakMinutes, val));
        }
    }, [hasStarted, phase, breakMinutes, getTotalBreakSeconds]);

    const handleSetTotalCycles = useCallback((newCycles: number) => {
        const val = Math.max(1, Math.min(12, newCycles));
        setTotalCycles(val);
    }, []);

    // Timestamp-based play
    const startTimer = useCallback(() => {
        const workTotal = getTotalWorkSeconds(workMinutes, workSeconds);
        const breakTotal = getTotalBreakSeconds(breakMinutes, breakSeconds);

        if (phase === "completed") {
            setPhase("work");
            setCurrentCycle(1);
            setRemainingSeconds(workTotal);
            targetEndTimeRef.current = Date.now() + workTotal * 1000;
        } else {
            const currentSecs = remainingSeconds > 0 ? remainingSeconds : (phase === "work" ? workTotal : breakTotal);
            targetEndTimeRef.current = Date.now() + currentSecs * 1000;
        }
        setIsRunning(true);
        setHasStarted(true);
    }, [phase, remainingSeconds, workMinutes, workSeconds, breakMinutes, breakSeconds, getTotalWorkSeconds, getTotalBreakSeconds]);

    // Pause timer and preserve exact remaining duration
    const pauseTimer = useCallback(() => {
        if (targetEndTimeRef.current) {
            const left = Math.max(0, Math.ceil((targetEndTimeRef.current - Date.now()) / 1000));
            setRemainingSeconds(left);
        }
        targetEndTimeRef.current = null;
        setIsRunning(false);
    }, []);

    const togglePlayPause = useCallback(() => {
        if (isRunning) {
            pauseTimer();
        } else {
            startTimer();
        }
    }, [isRunning, pauseTimer, startTimer]);

    // Hard reset back to initial configured state
    const resetTimer = useCallback(() => {
        targetEndTimeRef.current = null;
        setIsRunning(false);
        setHasStarted(false);
        setPhase("work");
        setCurrentCycle(1);
        setRemainingSeconds(getTotalWorkSeconds(workMinutes, workSeconds));
    }, [workMinutes, workSeconds, getTotalWorkSeconds]);

    // Main ticker loop using high-frequency timestamp checks
    useEffect(() => {
        if (!isRunning) return;

        const interval = setInterval(() => {
            if (!targetEndTimeRef.current) return;

            const now = Date.now();
            const left = Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000));
            setRemainingSeconds(left);

            if (left <= 0) {
                const workTotal = getTotalWorkSeconds(workMinutes, workSeconds);
                const breakTotal = getTotalBreakSeconds(breakMinutes, breakSeconds);

                if (phase === "work") {
                    playChime("phase");
                    if (breakTotal > 0) {
                        setPhase("break");
                        setRemainingSeconds(breakTotal);
                        targetEndTimeRef.current = Date.now() + breakTotal * 1000;
                    } else {
                        if (currentCycle < totalCycles) {
                            setCurrentCycle((c) => c + 1);
                            setRemainingSeconds(workTotal);
                            targetEndTimeRef.current = Date.now() + workTotal * 1000;
                        } else {
                            playChime("complete");
                            setPhase("completed");
                            setIsRunning(false);
                            targetEndTimeRef.current = null;
                        }
                    }
                } else if (phase === "break") {
                    if (currentCycle < totalCycles) {
                        playChime("phase");
                        setCurrentCycle((c) => c + 1);
                        setPhase("work");
                        setRemainingSeconds(workTotal);
                        targetEndTimeRef.current = Date.now() + workTotal * 1000;
                    } else {
                        playChime("complete");
                        setPhase("completed");
                        setIsRunning(false);
                        targetEndTimeRef.current = null;
                    }
                }
            }
        }, 200);

        return () => clearInterval(interval);
    }, [isRunning, phase, workMinutes, workSeconds, breakMinutes, breakSeconds, currentCycle, totalCycles, getTotalWorkSeconds, getTotalBreakSeconds]);

    // Window visibility & focus sync to guarantee 100% accuracy when minimized/backgrounded
    useEffect(() => {
        function syncFromTimestamp() {
            if (isRunning && targetEndTimeRef.current) {
                const now = Date.now();
                const left = Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000));
                setRemainingSeconds(left);
            }
        }

        window.addEventListener("focus", syncFromTimestamp);
        document.addEventListener("visibilitychange", syncFromTimestamp);
        return () => {
            window.removeEventListener("focus", syncFromTimestamp);
            document.removeEventListener("visibilitychange", syncFromTimestamp);
        };
    }, [isRunning]);

    return {
        workMinutes,
        workSeconds,
        setWorkMinutes: handleSetWorkMinutes,
        setWorkSeconds: handleSetWorkSeconds,
        breakMinutes,
        breakSeconds,
        setBreakMinutes: handleSetBreakMinutes,
        setBreakSeconds: handleSetBreakSeconds,
        totalCycles,
        setTotalCycles: handleSetTotalCycles,
        currentCycle,
        phase,
        isRunning,
        hasStarted,
        remainingSeconds,
        startTimer,
        pauseTimer,
        togglePlayPause,
        resetTimer,
    };
}
