import { useState, useEffect, useRef, useCallback } from "react";

/** Configurable polling interval in milliseconds, defaulting to 60,000ms (60 seconds) */
export const DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS = 60_000;

export interface UseDashboardAutoRefreshOptions {
    accountId: string | undefined;
    refreshTasks: () => Promise<void>;
    refreshSchedule: () => Promise<void>;
    refreshNotes: () => Promise<void>;
    intervalMs?: number;
}

export interface UseDashboardAutoRefreshReturn {
    isRefreshing: boolean;
    lastRefreshedAt: Date | null;
    refreshError: string | null;
    refreshAll: () => Promise<void>;
}

/**
 * Centralized dashboard coordinator that manages manual and 60-second automatic refresh cycles.
 * - Prevents concurrent / overlapping refresh executions
 * - Pauses polling when browser tab is hidden or network is offline
 * - Immediately refreshes if data is stale when returning to visibility or online
 * - Cleans up all timers and listeners on unmount
 * - Preserves existing data when refresh fails and exposes non-blocking error message
 */
export function useDashboardAutoRefresh({
    accountId,
    refreshTasks,
    refreshSchedule,
    refreshNotes,
    intervalMs = DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS,
}: UseDashboardAutoRefreshOptions): UseDashboardAutoRefreshReturn {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(() => new Date());
    const [refreshError, setRefreshError] = useState<string | null>(null);

    // Keep active callback refs to avoid recreating timers on callback identity changes
    const refreshTasksRef = useRef(refreshTasks);
    const refreshScheduleRef = useRef(refreshSchedule);
    const refreshNotesRef = useRef(refreshNotes);
    const lastRefreshedAtRef = useRef<Date | null>(lastRefreshedAt);
    const inFlightPromiseRef = useRef<Promise<void> | null>(null);
    const sequenceRef = useRef(0);

    useEffect(() => {
        refreshTasksRef.current = refreshTasks;
        refreshScheduleRef.current = refreshSchedule;
        refreshNotesRef.current = refreshNotes;
    }, [refreshTasks, refreshSchedule, refreshNotes]);

    useEffect(() => {
        lastRefreshedAtRef.current = lastRefreshedAt;
    }, [lastRefreshedAt]);

    const executeRefresh = useCallback(async (): Promise<void> => {
        if (!accountId) return;

        // If a refresh is already in flight, return the existing promise to prevent overlap
        if (inFlightPromiseRef.current) {
            return inFlightPromiseRef.current;
        }

        const currentSeq = ++sequenceRef.current;
        setIsRefreshing(true);
        setRefreshError(null);

        const promise = (async () => {
            try {
                // Execute all datasets in parallel using existing hook refresh mechanisms
                await Promise.all([
                    refreshTasksRef.current(),
                    refreshScheduleRef.current(),
                    refreshNotesRef.current(),
                ]);

                // Ensure an older request cannot overwrite newer state
                if (currentSeq === sequenceRef.current) {
                    const now = new Date();
                    setLastRefreshedAt(now);
                    lastRefreshedAtRef.current = now;
                    setRefreshError(null);
                }
            } catch (err: unknown) {
                if (currentSeq === sequenceRef.current) {
                    console.error("Dashboard refresh error:", err);
                    const msg = err instanceof Error ? err.message : "Failed to refresh dashboard data";
                    setRefreshError(msg);
                }
            } finally {
                if (currentSeq === sequenceRef.current) {
                    inFlightPromiseRef.current = null;
                    setIsRefreshing(false);
                }
            }
        })();

        inFlightPromiseRef.current = promise;
        return promise;
    }, [accountId]);

    // Automatic polling interval with pause/resume on visibility and connectivity
    useEffect(() => {
        if (!accountId || intervalMs <= 0) return;

        let intervalId: ReturnType<typeof setInterval> | null = null;

        const startTimer = () => {
            if (intervalId) clearInterval(intervalId);
            intervalId = setInterval(() => {
                if (typeof document !== "undefined" && document.hidden) return;
                if (typeof navigator !== "undefined" && !navigator.onLine) return;
                void executeRefresh();
            }, intervalMs);
        };

        startTimer();

        const handleVisibilityOrOnlineChange = () => {
            const isHidden = typeof document !== "undefined" && document.hidden;
            const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

            if (isHidden || isOffline) {
                // Pause timer while inactive/offline
                if (intervalId) {
                    clearInterval(intervalId);
                    intervalId = null;
                }
            } else {
                // Returned to foreground or online: check if stale
                const last = lastRefreshedAtRef.current;
                const now = Date.now();
                const isStale = !last || now - last.getTime() >= intervalMs;

                if (isStale) {
                    void executeRefresh();
                }
                startTimer();
            }
        };

        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", handleVisibilityOrOnlineChange);
        }
        if (typeof window !== "undefined") {
            window.addEventListener("online", handleVisibilityOrOnlineChange);
            window.addEventListener("offline", handleVisibilityOrOnlineChange);
        }

        // Also update lastRefreshedAt when an AI action executes so immediate subsequent poll isn't redundant
        const handleActionExecuted = () => {
            const now = new Date();
            setLastRefreshedAt(now);
            lastRefreshedAtRef.current = now;
        };
        window.addEventListener("alfred:action_executed", handleActionExecuted);

        return () => {
            if (intervalId) clearInterval(intervalId);
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", handleVisibilityOrOnlineChange);
            }
            if (typeof window !== "undefined") {
                window.removeEventListener("online", handleVisibilityOrOnlineChange);
                window.removeEventListener("offline", handleVisibilityOrOnlineChange);
            }
            window.removeEventListener("alfred:action_executed", handleActionExecuted);
        };
    }, [accountId, intervalMs, executeRefresh]);

    return {
        isRefreshing,
        lastRefreshedAt,
        refreshError,
        refreshAll: executeRefresh,
    };
}
