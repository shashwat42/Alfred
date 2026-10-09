import * as React from "react"
import { addDays } from "date-fns"

import { Calendar } from "./Calendar.tsx"

const presets = [
  { label: "Today", value: 0 },
  { label: "Tomorrow", value: 1 },
  { label: "In 3 days", value: 3 },
  { label: "In a week", value: 7 },
  { label: "In 2 weeks", value: 14 },
]

export function CalendarWithPresets({
  selectedDate,
  onDateChange,
}: {
  selectedDate?: Date;
  onDateChange: (date: Date) => void;
}) {
  const [date, setDate] = React.useState<Date | undefined>(() => selectedDate ?? new Date());
  const [currentMonth, setCurrentMonth] = React.useState(
    () => new Date((selectedDate ?? new Date()).getFullYear(), (selectedDate ?? new Date()).getMonth(), 1)
  );

  React.useEffect(() => {
    if (selectedDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDate(selectedDate);
      setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate]);

  const selectPreset = (days: number) => {
    const newDate = addDays(new Date(), days);
    setDate(newDate);
    onDateChange(newDate);
    setCurrentMonth(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
  };

  return (
    <section className="CalendarPresetCard" aria-label="Calendar and date presets">
      <div className="CalendarPresetContent">
        <Calendar
          mode="single"
          required
          selected={date}
          onSelect={(nextDate) => {
            const chosenDate = nextDate ?? date ?? new Date();
            setDate(chosenDate);
            onDateChange(chosenDate);
            setCurrentMonth(new Date(chosenDate.getFullYear(), chosenDate.getMonth(), 1));
          }}
          month={currentMonth}
          onMonthChange={setCurrentMonth}
          fixedWeeks
          className="DashboardCalendar"
        />
      </div>
      <div className="CalendarPresetFooter">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="CalendarPresetButton"
            onClick={() => selectPreset(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </section>
  )
}
