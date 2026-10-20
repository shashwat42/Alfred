import { memo, useEffect, useRef } from "react";
import { Bot, LayoutDashboard, Layers, Settings } from "lucide-react";

export type MobileNavDestination = "assistant" | "dashboard" | "workspace" | "settings";

export interface MobileBottomNavProps {
  activeDestination: MobileNavDestination | "other";
  onNavigate: (destination: MobileNavDestination) => void;
}

function MobileBottomNavComponent({
  activeDestination,
  onNavigate,
}: MobileBottomNavProps) {
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    const app = nav?.closest<HTMLElement>(".App.is-android");
    if (!nav || !app) return;
    const measure = () => app.style.setProperty("--android-nav-height", `${nav.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      app.style.removeProperty("--android-nav-height");
    };
  }, []);
  const items: Array<{
    id: MobileNavDestination;
    label: string;
    icon: typeof Bot;
  }> = [
    { id: "assistant", label: "Assistant", icon: Bot },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "workspace", label: "Workspace", icon: Layers },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav ref={navRef} className="mobile-bottom-nav" role="tablist" aria-label="Mobile Bottom Navigation">
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
