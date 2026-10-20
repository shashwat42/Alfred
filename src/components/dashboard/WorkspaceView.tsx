import { CalendarDays, ListTodo, NotebookPen, ArrowUpRight, Timer } from "lucide-react";
import type { DashboardView } from "../../types/dashboard.ts";

const sections = [
    { view: "schedule", title: "Schedule", description: "Plan your day and upcoming events", Icon: CalendarDays },
    { view: "tasks", title: "Tasks", description: "Organize what needs to get done", Icon: ListTodo },
    { view: "notes", title: "Notes", description: "Capture ideas and revisit your notes", Icon: NotebookPen },
] as const;

export function WorkspaceView({ onNavigate, onOpenFocusSession, focusTime }: { onNavigate: (view: DashboardView) => void; onOpenFocusSession?: () => void; focusTime?: string }) {
    return <nav className="workspace-hub" aria-label="Workspace">
        {onOpenFocusSession && <button type="button" className="workspace-hub-card workspace-hub-focus" onClick={onOpenFocusSession}>
            <Timer size={28} aria-hidden="true" />
            <span><strong>Focus Session{focusTime ? ` (${focusTime})` : ""}</strong><span>{focusTime ? "Return to your running session" : "Start a focused work session"}</span></span>
            <ArrowUpRight size={18} aria-hidden="true" />
        </button>}
        {sections.map(({ view, title, description, Icon }) => <button key={view} type="button" className={`workspace-hub-card workspace-hub-${view}`} onClick={() => onNavigate(view)}>
            <Icon size={28} aria-hidden="true" />
            <span><strong>{title}</strong><span>{description}</span></span>
            <ArrowUpRight size={18} aria-hidden="true" />
        </button>)}
    </nav>;
}
