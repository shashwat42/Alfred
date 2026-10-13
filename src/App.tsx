import { useState, useEffect, useRef } from "react";
import Chat, { VoiceModeHeaderIndicator, type VoiceHeaderState } from "./components/Chat";
import Dashboard from "./components/Dashboard";
import type { DashboardView } from "./types/dashboard.ts";
import Header from "./components/Header";
import { MobileBottomNav, type MobileNavDestination } from "./components/MobileBottomNav";
import { useAuth } from "./auth/authContext.ts";
import { audioRecorder } from "./lib/audioRecorder";
import Logo from "./assets/Alfred_Logo.svg";

type MobileTab = "assistant" | "dashboard";
const mobileNavOrder = ["assistant", "dashboard", "schedule", "tasks", "notes"] as const;
type SwipeDestination = (typeof mobileNavOrder)[number];

const App = () => {
  const isAndroidDevice = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const { loading, error, retry } = useAuth();
  const [currentView, setCurrentView] = useState<DashboardView>("home");
  const [mobileTab, setMobileTab] = useState<MobileTab>("assistant");
  const [voiceHeaderState, setVoiceHeaderState] = useState<VoiceHeaderState | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<"next" | "previous" | null>(null);
  const swipeAnimationTimerRef = useRef<number | null>(null);

  // Release microphone if user navigates away from assistant tab on mobile, but preserve active voice mode
  useEffect(() => {
    if (mobileTab === "dashboard" && (!voiceHeaderState || voiceHeaderState.voiceModeState === "off")) {
      audioRecorder.cancel();
    }
  }, [mobileTab, voiceHeaderState]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("alfred_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("alfred_sidebar_collapsed", String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const [chatResetSignal, setChatResetSignal] = useState(0);

  const handleNewChat = () => {
    setChatResetSignal((prev) => prev + 1);
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      try {
        localStorage.setItem("alfred_sidebar_collapsed", "false");
      } catch {
        // ignore storage errors
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleGoHome = () => {
    setCurrentView("home");
    setMobileTab("dashboard");
  };

  const handleMobileNavigate = (destination: MobileNavDestination) => {
    if (destination === "assistant") {
      setMobileTab("assistant");
    } else {
      setMobileTab("dashboard");
      setCurrentView(destination === "dashboard" ? "home" : destination);
    }
  };

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => () => {
    if (swipeAnimationTimerRef.current !== null) {
      window.clearTimeout(swipeAnimationTimerRef.current);
    }
  }, []);

  const isInteractiveOrScrollable = (target: HTMLElement | null): boolean => {
    if (!target) return false;
    if (
      target.closest(
        "input, textarea, select, button, [role='button'], [role='slider'], [role='dialog'], dialog, .dialog-backdrop, .chat-composer-box, .chat-prompt-input-wrapper, .timeline-event-chip"
      )
    ) {
      return true;
    }

    let el: HTMLElement | null = target;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.classList.contains("Main") || el.classList.contains("App")) {
        break;
      }
      try {
        const style = window.getComputedStyle(el);
        const overflowX = style.overflowX;
        const isScrollableX = (overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4;
        if (isScrollableX) {
          return true;
        }
      } catch {
        // Fallback for detached nodes
      }
      el = el.parentElement;
    }
    return false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (isInteractiveOrScrollable(target)) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    const minDistance = 50;
    if (elapsed < 500 && Math.abs(deltaX) >= minDistance && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      const activeDestination: SwipeDestination = mobileTab === "assistant"
        ? "assistant"
        : currentView === "home" || currentView === "settings"
        ? "dashboard"
        : currentView === "schedule"
        ? "schedule"
        : currentView === "tasks" || currentView === "todo"
        ? "tasks"
        : "notes";
      const currentIndex = mobileNavOrder.indexOf(activeDestination);
      const nextIndex = Math.max(0, Math.min(mobileNavOrder.length - 1, currentIndex + (deltaX < 0 ? 1 : -1)));
      const nextDestination = mobileNavOrder[nextIndex];

      if (nextDestination !== activeDestination) {
        const direction = deltaX < 0 ? "next" : "previous";
        setSwipeDirection(direction);
        if (swipeAnimationTimerRef.current !== null) {
          window.clearTimeout(swipeAnimationTimerRef.current);
        }
        swipeAnimationTimerRef.current = window.setTimeout(() => {
          setSwipeDirection(null);
          swipeAnimationTimerRef.current = null;
        }, 360);
        handleMobileNavigate(nextDestination);
      }
    }
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
  };

  return (
    <div
      className={`App ${isAndroidDevice ? "is-android" : ""}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <Header onGoHome={handleGoHome} />

      {/* Top Black Header with Alfred Branding (Android/Mobile only, consistent across all 6 destinations) */}
      <header className="mobile-top-header" role="banner">
        {voiceHeaderState && voiceHeaderState.voiceModeState !== "off" && !voiceHeaderState.isLogoCentered ? (
          <VoiceModeHeaderIndicator
            voiceModeState={voiceHeaderState.voiceModeState}
            modelLoadingText={voiceHeaderState.modelLoadingText}
            voiceModeError={voiceHeaderState.voiceModeError}
            voiceModeAudioLevel={voiceHeaderState.voiceModeAudioLevel}
            isMuted={voiceHeaderState.isVoiceMuted}
            isAnimatingIn={voiceHeaderState.isAnimatingIn}
            onRetry={voiceHeaderState.onRetry}
          />
        ) : (
          <div className="mobile-top-header-brand" onClick={handleGoHome} role="button" tabIndex={0}>
            <img src={Logo} alt="Alfred Logo" className="mobile-top-logo" />
            <span className="mobile-top-title">ALFRED</span>
          </div>
        )}
      </header>

      {error && (
        <div
          style={{
            padding: "8px 16px",
            backgroundColor: "#2a1515",
            color: "#f87171",
            textAlign: "center",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => retry()}
            style={{
              padding: "4px 10px",
              background: "#3f2020",
              color: "#fff",
              border: "1px solid #7f1d1d",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            color: "#888",
            fontSize: "14px",
          }}
        >
          Initializing session...
        </div>
      ) : (
        <>
          <main className={`Main mobile-tab-${mobileTab} ${swipeDirection ? `mobile-swipe-${swipeDirection}` : ""} ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
            <Chat
              key={chatResetSignal}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={handleToggleSidebar}
              onNewChat={handleNewChat}
              isActiveView={mobileTab === "assistant"}
              onVoiceStateChange={setVoiceHeaderState}
            />
            <Dashboard currentView={currentView} onViewChange={setCurrentView} />
          </main>
          <MobileBottomNav
            activeDestination={
              mobileTab === "assistant"
                ? "assistant"
                : currentView === "home"
                ? "dashboard"
                : currentView === "schedule"
                ? "schedule"
                : currentView === "tasks" || currentView === "todo"
                ? "tasks"
                : currentView === "notes" || currentView === "mails"
                ? "notes"
                : "other"
            }
            onNavigate={handleMobileNavigate}
          />
        </>
      )}
    </div>
  );
};

export default App;
