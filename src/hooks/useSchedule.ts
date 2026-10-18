import type { FormEvent } from "react";
import { useLoadState } from "./useLoadState";
import { httpMessage } from "../lib/requestError";
import { apiFetch } from "../lib/api.ts";
import type { ScheduleItem } from "../types/dashboard.ts";
import { useState, useEffect, useRef, useCallback } from "react";

interface ScheduleCacheEntry {
    promise?: Promise<ScheduleItem[]>;
    data?: ScheduleItem[];
    timestamp: number;
}

const scheduleRequestCache = new Map<string, ScheduleCacheEntry>();

async function fetchSchedule(url: string, accountId: string, maxAgeMs = 2000): Promise<ScheduleItem[]> {
    const cacheKey = `${accountId}:${url}`;
    const cached = scheduleRequestCache.get(cacheKey);
    if (cached) {
        if (cached.promise) {
            return cached.promise;
        }
        if (cached.data && Date.now() - cached.timestamp < maxAgeMs) {
            return cached.data;
        }
    }

    const promise: Promise<ScheduleItem[]> = (async () => {
        try {
            const response = await apiFetch(url);
            if (!response.ok) {
                throw new Error(httpMessage(response.status));
            }
            const data: ScheduleItem[] = await response.json();
            if (scheduleRequestCache.get(cacheKey)?.promise === promise) scheduleRequestCache.set(cacheKey, { data, timestamp: Date.now() });
            return data;
        } finally {
            const entry = scheduleRequestCache.get(cacheKey);
            if (entry?.promise === promise) {
                delete entry.promise;
            }
        }
    })();

    scheduleRequestCache.set(cacheKey, { promise, timestamp: Date.now() });
    return promise;
}

function invalidateScheduleCache(date?: string) {
    if (date) {
        for (const key of scheduleRequestCache.keys()) if (key.endsWith(`/api/schedule?date=${date}`)) scheduleRequestCache.delete(key);
    } else {
        scheduleRequestCache.clear();
    }
}

/** Custom hook to manage all schedule-related state and handlers. */
export function useSchedule(accountId: string | undefined, todayDateStr: string) {
    const { run, ...loadState } = useLoadState();
    const submission = useRef(false);
    const clearRequest = useRef(false), loadGeneration = useRef(0);
    const [isClearing, setClearing] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const [scheduleSelectedDate, setScheduleSelectedDate] = useState(() => new Date());
    const scheduleDate = `${scheduleSelectedDate.getFullYear()}-${String(scheduleSelectedDate.getMonth() + 1).padStart(2, "0")}-${String(scheduleSelectedDate.getDate()).padStart(2, "0")}`;

    const [todaySchedule, setTodaySchedule] = useState<ScheduleItem[]>([]);
    const [timelineSchedule, setTimelineSchedule] = useState<ScheduleItem[]>([]);
    
    const [newScheduleTime, setNewScheduleTime] = useState("");
    const [newScheduleTopic, setNewScheduleTopic] = useState("");
    const [newScheduleDate, setNewScheduleDate] = useState(scheduleDate);
    const [scheduleError, setScheduleError] = useState("");
    
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    
    const currentHourRef = useRef<HTMLDivElement | null>(null);

    const loadTodaySchedule = useCallback(async () => run(async () => {
        if (!accountId) return;
        const generation = loadGeneration.current;
        try {
            const data = await fetchSchedule(`/api/schedule?date=${todayDateStr}`, accountId!);
            if (generation === loadGeneration.current) setTodaySchedule(data);
        } catch (error) {
            console.error("Could not load today's schedule:", error);
            throw error;
        }
    }), [accountId, todayDateStr, run]);

    const loadTimelineSchedule = useCallback(async () => run(async () => {
        if (!accountId) return;
        const generation = loadGeneration.current;
        try {
            const data = await fetchSchedule(`/api/schedule?date=${scheduleDate}`, accountId!);
            if (generation === loadGeneration.current) setTimelineSchedule(data);
        } catch (error) {
            console.error("Could not load timeline schedule:", error);
            throw error;
        }
    }), [accountId, scheduleDate, run]);

    const refreshSchedule = useCallback(async () => {
        if (!accountId) return;
        invalidateScheduleCache(todayDateStr);
        if (scheduleDate !== todayDateStr) {
            invalidateScheduleCache(scheduleDate);
        }
        await Promise.all([loadTodaySchedule(), loadTimelineSchedule()]);
    }, [accountId, todayDateStr, scheduleDate, loadTodaySchedule, loadTimelineSchedule]);

    // Initial and dependency-driven fetch for today's schedule
    useEffect(() => {
        if (!accountId) return;
        let isMounted = true;
        async function fetchToday() {
            const generation = loadGeneration.current;
            try {
                const data = await run(() => fetchSchedule(`/api/schedule?date=${todayDateStr}`, accountId!));
                if (isMounted && generation === loadGeneration.current) setTodaySchedule(data);
            } catch (error) {
                console.error("Could not load today's schedule:", error);
            }
        }
        void fetchToday();
        return () => {
            isMounted = false;
        };
    }, [accountId, todayDateStr, run]);

    // Initial and dependency-driven fetch for timeline schedule
    useEffect(() => {
        if (!accountId) return;
        let isMounted = true;
        async function fetchTimeline() {
            const generation = loadGeneration.current;
            try {
                const data = await run(() => fetchSchedule(`/api/schedule?date=${scheduleDate}`, accountId!));
                if (isMounted && generation === loadGeneration.current) setTimelineSchedule(data);
            } catch (error) {
                console.error("Could not load timeline schedule:", error);
            }
        }
        void fetchTimeline();
        return () => {
            isMounted = false;
        };
    }, [accountId, scheduleDate, run]);

    // Keep latest references for the dedicated action listener to avoid stale closures
    const todayDateStrRef = useRef(todayDateStr);
    const scheduleDateRef = useRef(scheduleDate);
    const loadTodayRef = useRef(loadTodaySchedule);
    const loadTimelineRef = useRef(loadTimelineSchedule);

    useEffect(() => {
        todayDateStrRef.current = todayDateStr;
        scheduleDateRef.current = scheduleDate;
        loadTodayRef.current = loadTodaySchedule;
        loadTimelineRef.current = loadTimelineSchedule;
    });

    // Consolidated single listener for schedule mutations
    useEffect(() => {
        const handleActionExecuted = (event: Event) => {
            const customEvt = event as CustomEvent<{ actions?: Array<{ type?: string }> }>;
            const actions = customEvt.detail?.actions;
            if (
                Array.isArray(actions) &&
                actions.some(
                    (a) =>
                        a.type === "schedule_created" ||
                        a.type === "schedule_updated" ||
                        a.type === "schedule_deleted" ||
                        a.type === "schedule_cleared"
                )
            ) {
                const today = todayDateStrRef.current;
                loadGeneration.current++;
                if (actions.some(action => action.type === "schedule_cleared")) invalidateScheduleCache();
                const timeline = scheduleDateRef.current;
                invalidateScheduleCache(today);
                if (timeline && timeline !== today) {
                    invalidateScheduleCache(timeline);
                }
                void loadTodayRef.current().catch(() => {});
                void loadTimelineRef.current().catch(() => {});
            }
        };

        window.addEventListener("alfred:action_executed", handleActionExecuted);
        return () => {
            window.removeEventListener("alfred:action_executed", handleActionExecuted);
        };
    }, []);

    async function handleAddSchedule(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const time = newScheduleTime.trim();
        const topic = newScheduleTopic.trim();
        if (!time || !topic || submission.current || clearRequest.current) return;
        submission.current = true; setSubmitting(true);

        setScheduleError("");
        try {
            const response = await apiFetch("/api/schedule", {
                method: "POST",
                body: JSON.stringify({ schedule: { time, topic, date: newScheduleDate } }),
            });
            if (!response.ok) {
                const errorData = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(errorData?.error || `Request failed: ${response.status}`);
            }

            const data: { schedule: ScheduleItem } = await response.json();
            invalidateScheduleCache(newScheduleDate);
            invalidateScheduleCache(todayDateStr);
            if (data.schedule.date === todayDateStr) {
                setTodaySchedule((curr) =>
                    [...curr, data.schedule].sort((a, b) => a.time.localeCompare(b.time))
                );
            }
            if (data.schedule.date === scheduleDate) {
                setTimelineSchedule((curr) =>
                    [...curr, data.schedule].sort((a, b) => a.time.localeCompare(b.time))
                );
            }
            setNewScheduleTime("");
            setNewScheduleTopic("");
            setIsScheduleDialogOpen(false);
        } catch (error) {
            console.error("Could not add schedule item:", error);
            setScheduleError(error instanceof Error ? error.message : "Could not add schedule item. Please try again.");
        } finally { submission.current = false; setSubmitting(false); }
    }

    async function handleDeleteSchedule(id: string) {
        if (clearRequest.current) return;
        try {
            const response = await apiFetch(`/api/schedule/${id}`, { method: "DELETE" });
            if (response.ok) {
                invalidateScheduleCache(scheduleDate);
                invalidateScheduleCache(todayDateStr);
                setTodaySchedule((prev) => prev.filter((item) => item._id !== id));
                setTimelineSchedule((prev) => prev.filter((item) => item._id !== id));
            }
        } catch (err) {
            console.error("Could not delete schedule item:", err);
        }
    }

    async function handleClearSchedules(scope: "date" | "all", date?: string): Promise<boolean> {
        if (!accountId || clearRequest.current || submission.current) return false;
        if (scope === "date" && !date) { setScheduleError("Choose a date to clear."); return false; }
        clearRequest.current = true; setClearing(true); setScheduleError("");
        loadGeneration.current++;
        try {
            const url = scope === "all" ? "/api/schedule/clear-all" : `/api/schedule?date=${encodeURIComponent(date!)}`;
            const response = await apiFetch(url, { method: "DELETE", _expectedAccountId: accountId });
            if (!response.ok) {
                const failure = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(failure?.error || httpMessage(response.status));
            }
            loadGeneration.current++;
            invalidateScheduleCache();
            if (scope === "all" || date === todayDateStrRef.current) setTodaySchedule([]);
            if (scope === "all" || date === scheduleDateRef.current) setTimelineSchedule([]);
            return true;
        } catch (error) {
            setScheduleError(error instanceof Error ? error.message : "Could not clear the schedule. Please try again.");
            return false;
        } finally { clearRequest.current = false; setClearing(false); }
    }

    const handlePrevDay = () => {
        const prev = new Date(scheduleSelectedDate);
        prev.setDate(prev.getDate() - 1);
        setScheduleSelectedDate(prev);
    };

    const handleNextDay = () => {
        const next = new Date(scheduleSelectedDate);
        next.setDate(next.getDate() + 1);
        setScheduleSelectedDate(next);
    };

    const handleToday = () => {
        setScheduleSelectedDate(new Date());
    };

    return {
        ...loadState,
        isSubmitting,
        isClearing,
        scheduleSelectedDate,
        setScheduleSelectedDate,
        scheduleDate,
        todaySchedule,
        timelineSchedule,
        newScheduleTime,
        setNewScheduleTime,
        newScheduleTopic,
        setNewScheduleTopic,
        newScheduleDate,
        setNewScheduleDate,
        scheduleError,
        setScheduleError,
        isScheduleDialogOpen,
        setIsScheduleDialogOpen,
        isCalendarOpen,
        setIsCalendarOpen,
        currentHourRef,
        handleAddSchedule,
        handleDeleteSchedule,
        handleClearSchedules,
        handlePrevDay,
        handleNextDay,
        handleToday,
        refreshSchedule,
    };
}
