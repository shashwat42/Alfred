import { CalendarDays, ListTodo, NotebookPen, ArrowUpRight } from "lucide-react";
import type { DashboardView } from "../../types/dashboard.ts";

const sections = [
    { view: "schedule", title: "Schedule", description: "Plan your day and upcoming events", Icon: CalendarDays },
    { view: "tasks", title: "Tasks", description: "Organize what needs to get done", Icon: ListTodo },
    { view: "notes", title: "Notes", description: "Capture ideas and revisit your notes", Icon: NotebookPen },
] as const;

export function WorkspaceView({ onNavigate }: { onNavigate: (view: DashboardView) => void }) {
    return <nav className="workspace-hub" aria-label="Schedule, tasks and notes">
        {sections.map(({ view, title, description, Icon }) => <button key={view} type="button" className={`workspace-hub-card workspace-hub-${view}`} onClick={() => onNavigate(view)}>
            <Icon size={28} aria-hidden="true" />
            <span><strong>{title}</strong><span>{description}</span></span>
            <ArrowUpRight size={18} aria-hidden="true" />
        </button>)}
    </nav>;
}
