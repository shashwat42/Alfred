import { memo } from "react";
import { Bot, LayoutDashboard, Calendar, CheckSquare, FileText } from "lucide-react";

export type MobileNavDestination = "assistant" | "dashboard" | "schedule" | "tasks" | "notes" | "settings";

export interface MobileBottomNavProps {
  activeDestination: MobileNavDestination | "other";
  onNavigate: (destination: MobileNavDestination) => void;
}

function MobileBottomNavComponent({
  activeDestination,
  onNavigate,
}: MobileBottomNavProps) {
  const items: Array<{
    id: MobileNavDestination;
    label: string;
    icon: typeof Bot;
  }> = [
    { id: "assistant", label: "Assistant", icon: Bot },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "tasks", label: "Tasks", icon: CheckSquare },
    { id: "notes", label: "Notes", icon: FileText },
  ];

  return (
    <nav className="mobile-bottom-nav" role="tablist" aria-label="Mobile Bottom Navigation">
      <div className="mobile-bottom-nav-inner">
        {items.map(({ id, label, icon: Icon }) => {
          const isActive = activeDestination === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`mobile-bottom-nav-btn ${isActive ? "active" : ""}`}
              onClick={() => onNavigate(id)}
            >
              <div className="mobile-nav-pill">
                <Icon
                  size={19}
                  className="mobile-nav-icon"
                  strokeWidth={isActive ? 2.3 : 1.9}
                  aria-hidden="true"
                />
              </div>
              <span className="mobile-nav-label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export const MobileBottomNav = memo(MobileBottomNavComponent);
export default MobileBottomNav;
