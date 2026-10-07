import * as React from "react"
import { addDays } from "date-fns"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"

const presets = [
  { label: "Today", value: 0 },
  { label: "Tomorrow", value: 1 },
  { label: "In 3 days", value: 3 },
  { label: "In a week", value: 7 },
  { label: "In 2 weeks", value: 14 },
]

export function CalendarWithPresets({ onDateChange }: { onDateChange: (date: Date) => void }) {
  const [date, setDate] = React.useState<Date | undefined>(() => new Date())
  const [currentMonth, setCurrentMonth] = React.useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  )

  const selectPreset = (days: number) => {
    const newDate = addDays(new Date(), days)
    setDate(newDate)
    onDateChange(newDate)
    setCurrentMonth(new Date(newDate.getFullYear(), newDate.getMonth(), 1))
  }

  return (
    <section className="CalendarPresetCard" aria-label="Calendar and date presets">
      <div className="CalendarPresetContent">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(nextDate) => {
            if (!nextDate) return
            setDate(nextDate)
            onDateChange(nextDate)
            setCurrentMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1))
          }}
          month={currentMonth}
          onMonthChange={setCurrentMonth}
          fixedWeeks
          className="DashboardCalendar"
        />
      </div>
      <div className="CalendarPresetFooter">
        {presets.map((preset) => (
          <Button
            key={preset.value}
            type="button"
            variant="outline"
            size="sm"
            className="CalendarPresetButton"
            onClick={() => selectPreset(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </section>
  )
}
