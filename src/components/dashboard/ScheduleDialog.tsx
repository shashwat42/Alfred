import { ErrorNotice } from "../reliability/Notifications";
import { useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Calendar, Clock } from "lucide-react";

export function ScheduleDialog({
    newScheduleDate,
    setNewScheduleDate,
    newScheduleTime,
    setNewScheduleTime,
    newScheduleTopic,
    setNewScheduleTopic,
    handleAddSchedule,
    scheduleError,
    setIsScheduleDialogOpen,
    isSubmitting = false,
}: {
    newScheduleDate: string;
    setNewScheduleDate: (date: string) => void;
    newScheduleTime: string;
    setNewScheduleTime: (time: string) => void;
    newScheduleTopic: string;
    setNewScheduleTopic: (topic: string) => void;
    handleAddSchedule: (e: FormEvent<HTMLFormElement>) => Promise<void>;
    scheduleError: string;
    setIsScheduleDialogOpen: Dispatch<SetStateAction<boolean>>;
    isSubmitting?: boolean;
}) {
    const datePickerRef = useRef<HTMLInputElement>(null);
    const timePickerRef = useRef<HTMLInputElement>(null);
    const [clientError, setClientError] = useState("");

    const formatTimeInput = (raw: string, prev: string): string => {
        if (prev.endsWith(":") && raw === prev.slice(0, -1)) {
            return raw.slice(0, -1);
        }

        const digits = raw.replace(/\D/g, "").slice(0, 4);
        if (!digits) return "";

        if (digits.length === 1) {
            if (Number(digits[0]) > 2) {
                return `0${digits[0]}:`;
            }
            return digits;
        }

        let h1 = digits[0];
        let h2 = digits[1];
        const hour = parseInt(h1 + h2, 10);
        if (hour > 23) {
            h1 = "2";
            h2 = "3";
        }

        if (digits.length === 2) {
            return `${h1}${h2}:`;
        }

        let m1 = digits[2];
        if (Number(m1) > 5) {
            m1 = "5";
        }

        if (digits.length === 3) {
            return `${h1}${h2}:${m1}`;
        }

        const m2 = digits[3];
        return `${h1}${h2}:${m1}${m2}`;
    };

    const formatDateInput = (raw: string, prev: string): string => {
        if (prev.endsWith("-") && raw === prev.slice(0, -1)) {
            return raw.slice(0, -1);
        }
        const digits = raw.replace(/\D/g, "").slice(0, 8);
        if (!digits) return "";
        if (digits.length < 4) {
            return digits;
        }
        if (digits.length === 4) {
            return `${digits}-`;
        }
        const year = digits.slice(0, 4);
        if (digits.length <= 6) {
            const month = digits.slice(4);
            if (month.length === 2) {
                let mNum = parseInt(month, 10);
                if (mNum > 12) mNum = 12;
                if (mNum === 0) mNum = 1;
                return `${year}-${mNum.toString().padStart(2, "0")}-`;
            }
            return `${year}-${month}`;
        }
        let mNum = parseInt(digits.slice(4, 6), 10);
        if (mNum > 12) mNum = 12;
        if (mNum === 0) mNum = 1;
        const month = mNum.toString().padStart(2, "0");
        const day = digits.slice(6, 8);
        return `${year}-${month}-${day}`;
    };

    const handleTimeBlur = () => {
        if (!newScheduleTime) return;
        const digits = newScheduleTime.replace(/\D/g, "");
        if (digits.length === 0) return;
        if (digits.length <= 2) {
            let hour = parseInt(digits, 10);
            if (hour > 23) hour = 23;
            setNewScheduleTime(`${hour.toString().padStart(2, "0")}:00`);
        } else if (digits.length === 3) {
            const h = digits.slice(0, 2);
            const m = digits.slice(2).padEnd(2, "0");
            setNewScheduleTime(`${h}:${m}`);
        }
    };

    const validateAndSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setClientError("");

        // Validate Date: YYYY-MM-DD
        const dateMatch = newScheduleDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) {
            setClientError("Please enter date in valid YYYY-MM-DD format.");
            return;
        }
        const year = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10);
        const day = parseInt(dateMatch[3], 10);
        if (month < 1 || month > 12) {
            setClientError("Invalid month. Month must be between 01 and 12.");
            return;
        }
        const parsedDate = new Date(year, month - 1, day);
        if (
            parsedDate.getFullYear() !== year ||
            parsedDate.getMonth() !== month - 1 ||
            parsedDate.getDate() !== day
        ) {
            setClientError("Invalid calendar date (e.g. check number of days in month / leap year).");
            return;
        }

        // Validate Time: HH:MM
        const timeMatch = newScheduleTime.trim().match(/^([01]\d|2[0-3]):[0-5]\d$/);
        if (!timeMatch) {
            setClientError("Please enter time in valid HH:MM format (00:00 - 23:59).");
            return;
        }

        await handleAddSchedule(e);
    };

    return createPortal(
        <div
            className="task-dialog-backdrop"
            onClick={(event) => {
                if (event.target === event.currentTarget) setIsScheduleDialogOpen(false);
            }}
        >
            <section
                className="task-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="schedule-dialog-title"
            >
                <div className="task-dialog-heading">
                    <h2 id="schedule-dialog-title">Add to schedule</h2>
                    <button
                        className="task-dialog-close"
                        type="button"
                        aria-label="Close dialog"
                        onClick={() => setIsScheduleDialogOpen(false)}
                    >
                        ×
                    </button>
                </div>
                <form className="schedule-add-form" onSubmit={validateAndSubmit}>
                    <label>
                        Date
                        <div className="schedule-input-with-icon">
                            <input
                                type="text"
                                inputMode="numeric"
                                required
                                placeholder="YYYY-MM-DD"
                                maxLength={10}
                                value={newScheduleDate}
                                onChange={(event) => {
                                    setClientError("");
                                    const formatted = formatDateInput(event.target.value, newScheduleDate);
                                    setNewScheduleDate(formatted);
                                }}
                            />
                            <button
                                type="button"
                                className="schedule-icon-trigger-btn"
                                aria-label="Open date picker"
                                title="Open date picker"
                                onClick={() => {
                                    try {
                                        datePickerRef.current?.showPicker();
                                    } catch {
                                        datePickerRef.current?.focus();
                                    }
                                }}
                            >
                                <Calendar size={18} color="#ffffff" aria-hidden="true" />
                            </button>
                            <input
                                ref={datePickerRef}
                                type="date"
                                tabIndex={-1}
                                className="schedule-hidden-native-picker"
                                value={newScheduleDate}
                                onChange={(event) => {
                                    setClientError("");
                                    setNewScheduleDate(event.target.value);
                                }}
                            />
                        </div>
                    </label>
                    <label>
                        Time
                        <div className="schedule-input-with-icon">
                            <input
                                autoFocus
                                type="text"
                                inputMode="numeric"
                                required
                                placeholder="HH:MM (e.g. 14:00)"
                                maxLength={5}
                                value={newScheduleTime}
                                onBlur={handleTimeBlur}
                                onChange={(event) => {
                                    setClientError("");
                                    const formatted = formatTimeInput(event.target.value, newScheduleTime);
                                    setNewScheduleTime(formatted);
                                }}
                            />
                            <button
                                type="button"
                                className="schedule-icon-trigger-btn"
                                aria-label="Open time picker"
                                title="Open time picker"
                                onClick={() => {
                                    try {
                                        timePickerRef.current?.showPicker();
                                    } catch {
                                        timePickerRef.current?.focus();
                                    }
                                }}
                            >
                                <Clock size={18} color="#ffffff" aria-hidden="true" />
                            </button>
                            <input
                                ref={timePickerRef}
                                type="time"
                                tabIndex={-1}
                                className="schedule-hidden-native-picker"
                                value={newScheduleTime}
                                onChange={(event) => {
                                    setClientError("");
                                    setNewScheduleTime(event.target.value);
                                }}
                            />
                        </div>
                    </label>
                    <label>
                        Topic
                        <input
                            type="text"
                            required
                            placeholder="What is scheduled?"
                            value={newScheduleTopic}
                            onChange={(event) => setNewScheduleTopic(event.target.value)}
                        />
                    </label>
                    <button className="task-add-trigger" type="submit" disabled={isSubmitting}>
                        Add schedule
                    </button>
                </form>
                <ErrorNotice message={clientError || scheduleError} />
            </section>
        </div>,
        document.body
    );
}
