import Logo from "../assets/Alfred_Logo.svg";
import { isTauri } from "../auth/auth.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface HeaderProps {
  onGoHome?: () => void;
}

export default function Header({ onGoHome }: HeaderProps) {
  const inTauri = isTauri();

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.error("Minimize error:", e);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (e) {
      console.error("Toggle maximize error:", e);
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      console.error("Close error:", e);
    }
  };

  return (
    <header className="Header" data-tauri-drag-region>
      <div
        className="HeaderBrand"
        onClick={onGoHome}
        onKeyDown={(e) => {
          if (onGoHome && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onGoHome();
          }
        }}
        role={onGoHome ? "button" : undefined}
        tabIndex={onGoHome ? 0 : undefined}
        style={{ cursor: onGoHome ? "pointer" : "default" }}
      >
        <img src={Logo} alt="Alfred Logo" />
        <h1>ALFRED</h1>
      </div>

      {inTauri && (
        <div
          className="header-window-controls"
          aria-label="Window controls"
          data-tauri-drag-region="false"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="window-control-btn window-control-minimize"
            onClick={handleMinimize}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Minimize window"
            title="Minimize"
            data-tauri-drag-region="false"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <rect width="10" height="1" />
            </svg>
          </button>
          <button
            type="button"
            className="window-control-btn window-control-maximize"
            onClick={handleToggleMaximize}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Maximize window"
            title="Maximize"
            data-tauri-drag-region="false"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>
          <button
            type="button"
            className="window-control-btn window-control-close"
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Close window"
            title="Close"
            data-tauri-drag-region="false"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}