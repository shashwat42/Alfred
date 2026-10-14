import type { FormEvent } from "react";
import { apiFetch } from "../lib/api.ts";
import type { ScheduleItem } from "../types/dashboard.ts";
import { useState, useEffect, useRef, useCallback } from "react";

interface ScheduleCacheEntry {
    promise?: Promise<ScheduleItem[]>;
    data?: ScheduleItem[];
    timestamp: number;
}

const scheduleRequestCache = new Map<string, ScheduleCacheEntry>();

async function fetchSchedule(url: string, maxAgeMs = 2000): Promise<ScheduleItem[]> {
    const cached = scheduleRequestCache.get(url);
    if (cached) {
        if (cached.promise) {
            return cached.promise;
        }
        if (cached.data && Date.now() - cached.timestamp < maxAgeMs) {
            return cached.data;
        }
    }

    const promise = (async () => {
        try {
            const response = await apiFetch(url);
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }
            const data: ScheduleItem[] = await response.json();
            scheduleRequestCache.set(url, { data, timestamp: Date.now() });
            return data;
        } finally {
            const entry = scheduleRequestCache.get(url);
            if (entry && entry.promise) {
                delete entry.promise;
            }
        }
    })();

    scheduleRequestCache.set(url, { promise, timestamp: Date.now() });
    return promise;
}

function invalidateScheduleCache(date?: string) {
    if (date) {
        scheduleRequestCache.delete(`/api/schedule?date=${date}`);
    } else {
        scheduleRequestCache.clear();
    }
}

/** Custom hook to manage all schedule-related state and handlers. */
export function useSchedule(accountId: string | undefined, todayDateStr: string) {
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

    const loadTodaySchedule = useCallback(async () => {
        if (!accountId) return;
        try {
            const data = await fetchSchedule(`/api/schedule?date=${todayDateStr}`);
            setTodaySchedule(data);
        } catch (error) {
            console.error("Could not load today's schedule:", error);
            throw error;
        }
    }, [accountId, todayDateStr]);

    const loadTimelineSchedule = useCallback(async () => {
        if (!accountId) return;
        try {
            const data = await fetchSchedule(`/api/schedule?date=${scheduleDate}`);
            setTimelineSchedule(data);
        } catch (error) {
            console.error("Could not load timeline schedule:", error);
            throw error;
        }
    }, [accountId, scheduleDate]);

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
            try {
                const data = await fetchSchedule(`/api/schedule?date=${todayDateStr}`);
                if (isMounted) setTodaySchedule(data);
            } catch (error) {
                console.error("Could not load today's schedule:", error);
            }
        }
        void fetchToday();
        return () => {
            isMounted = false;
        };
    }, [accountId, todayDateStr]);

    // Initial and dependency-driven fetch for timeline schedule
    useEffect(() => {
        if (!accountId) return;
        let isMounted = true;
        async function fetchTimeline() {
            try {
                const data = await fetchSchedule(`/api/schedule?date=${scheduleDate}`);
                if (isMounted) setTimelineSchedule(data);
            } catch (error) {
                console.error("Could not load timeline schedule:", error);
            }
        }
        void fetchTimeline();
        return () => {
            isMounted = false;
        };
    }, [accountId, scheduleDate]);

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
                        a.type === "schedule_deleted"
                )
            ) {
                const today = todayDateStrRef.current;
                const timeline = scheduleDateRef.current;
                invalidateScheduleCache(today);
                if (timeline && timeline !== today) {
                    invalidateScheduleCache(timeline);
                }
                void loadTodayRef.current();
                void loadTimelineRef.current();
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
        if (!time || !topic) return;

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
        }
    }

    async function handleDeleteSchedule(id: string) {
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
        handlePrevDay,
        handleNextDay,
        handleToday,
        refreshSchedule,
    };
}
