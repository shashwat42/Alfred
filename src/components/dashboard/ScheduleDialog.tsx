import type { Dispatch, FormEvent, SetStateAction } from "react";

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
}) {
    return (
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
                <form className="schedule-add-form" onSubmit={handleAddSchedule}>
                    <label>
                        Date
                        <input
                            type="date"
                            required
                            value={newScheduleDate}
                            onChange={(event) => setNewScheduleDate(event.target.value)}
                        />
                    </label>
                    <label>
                        Time
                        <input
                            autoFocus
                            type="time"
                            required
                            value={newScheduleTime}
                            onChange={(event) => setNewScheduleTime(event.target.value)}
                        />
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
                    <button className="task-add-trigger" type="submit">
                        Add schedule
                    </button>
                </form>
                {scheduleError && <p className="task-error" role="alert">{scheduleError}</p>}
            </section>
        </div>
    );
}
