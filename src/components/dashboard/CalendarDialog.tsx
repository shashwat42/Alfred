import { CalendarWithPresets } from "../ui/CalendarWithPresets.tsx";

export function CalendarDialog({
    scheduleSelectedDate,
    setScheduleSelectedDate,
    setIsCalendarOpen,
}: {
    scheduleSelectedDate: Date;
    setScheduleSelectedDate: (date: Date) => void;
    setIsCalendarOpen: (open: boolean) => void;
}) {
    return (
        <div
            className="task-dialog-backdrop"
            onClick={(event) => {
                if (event.target === event.currentTarget) setIsCalendarOpen(false);
            }}
        >
            <section
                className="calendar-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Calendar date selection"
            >
                <div className="task-dialog-heading">
                    <h2>Select Date</h2>
                    <button
                        className="task-dialog-close"
                        type="button"
                        aria-label="Close dialog"
                        onClick={() => setIsCalendarOpen(false)}
                    >
                        ×
                    </button>
                </div>
                <CalendarWithPresets
                    selectedDate={scheduleSelectedDate}
                    onDateChange={(date) => {
                        setScheduleSelectedDate(date);
                        setIsCalendarOpen(false);
                    }}
                />
            </section>
        </div>
    );
}
