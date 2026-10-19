import { ErrorNotice } from "./components/reliability/Notifications";
import { useState, useEffect, useRef, useCallback } from "react";
import Chat, { VoiceModeHeaderIndicator, type VoiceHeaderState } from "./components/Chat";
import Dashboard from "./components/Dashboard";
import type { DashboardView } from "./types/dashboard.ts";
import Header from "./components/Header";
import { MobileBottomNav, type MobileNavDestination } from "./components/MobileBottomNav";
import { useAuth } from "./auth/authContext.ts";
import { audioRecorder } from "./lib/audioRecorder";
import { getAccountPreferences, saveAccountPreferences, PREFERENCES_CHANGED_EVENT } from "./lib/accountPreferences.ts";
import Logo from "./assets/Alfred_Logo.svg";
import { StateControl } from "./components/reliability/StateControl";
import { NOTIFICATION_OPEN_EVENT } from "./lib/scheduleNotifications.ts";
import { HoldDetails } from "./components/HoldDetails.tsx";

type MobileTab = "assistant" | "dashboard";
const mobileNavOrder = ["assistant", "dashboard", "workspace", "settings"] as const;
type SwipeDestination = (typeof mobileNavOrder)[number];
function navigateSafely(proceed: () => void) {
  if (window.dispatchEvent(new CustomEvent("alfred:before-navigate", { cancelable: true, detail: proceed }))) proceed();
}

const App = () => {
  const isAndroidDevice = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const { loading, error, retry, session } = useAuth();
  const [currentView, setCurrentView] = useState<DashboardView>("home");
  const [mobileTab, setMobileTab] = useState<MobileTab>("assistant");
  const [voiceHeaderState, setVoiceHeaderState] = useState<VoiceHeaderState | null>(null);
  useEffect(() => {
    const open = () => navigateSafely(() => { setMobileTab("dashboard"); setCurrentView("schedule"); });
    window.addEventListener(NOTIFICATION_OPEN_EVENT, open);
    return () => window.removeEventListener(NOTIFICATION_OPEN_EVENT, open);
  }, []);
  const [swipeDirection, setSwipeDirection] = useState<"next" | "previous" | null>(null);
  const swipeAnimationTimerRef = useRef<number | null>(null);

  // Release microphone if user navigates away from assistant tab on mobile, but preserve active voice mode
  useEffect(() => {
    if (mobileTab === "dashboard" && (!voiceHeaderState || voiceHeaderState.voiceModeState === "off")) {
      audioRecorder.cancel();
    }
  }, [mobileTab, voiceHeaderState]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => getAccountPreferences().sidebarCollapsed);
  useEffect(() => {
    const changed = () => setIsSidebarCollapsed(getAccountPreferences().sidebarCollapsed);
    changed(); window.addEventListener(PREFERENCES_CHANGED_EVENT, changed);
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener(PREFERENCES_CHANGED_EVENT, changed); window.removeEventListener("storage", changed); };
  }, [session?.account.id]);
  const handleToggleSidebar = useCallback(() => {
    const next = !isSidebarCollapsed;
    saveAccountPreferences({ sidebarCollapsed: next }); setIsSidebarCollapsed(next);
  }, [isSidebarCollapsed]);
  const navigation = useRef<{ tab: MobileTab; view: DashboardView }[]>([]);
  const lastScreen = useRef({ tab: mobileTab, view: currentView });
  const returning = useRef(false);
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => {
    navigation.current = [];
  }, [session?.account.id]);
  useEffect(() => {
    const last = lastScreen.current;
    if (last.tab === mobileTab && last.view === currentView) return;
    if (!returning.current) navigation.current.push(last);
    returning.current = false; lastScreen.current = { tab: mobileTab, view: currentView };
  }, [mobileTab, currentView]);
  useEffect(() => {
    const back = (event: Event) => {
      if (event.defaultPrevented) return;
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (dialog) { dialog.dispatchEvent(new Event("cancel", { cancelable: true })); event.preventDefault(); return; }
      const previous = navigation.current.pop();
      const target = previous ?? { tab: "dashboard", view: "home" };
      returning.current = lastScreen.current.tab !== target.tab || lastScreen.current.view !== target.view;
      setMobileTab(target.tab); setCurrentView(target.view);
      event.preventDefault();
    };
    const note = (event: Event) => setNoteOpen((event as CustomEvent<boolean>).detail);
    window.addEventListener("alfred:back", back); window.addEventListener("alfred:note-open", note);
    return () => { window.removeEventListener("alfred:back", back); window.removeEventListener("alfred:note-open", note); };
  }, []);

  useEffect(() => {
    const navigate = (event: Event) => {
      const view = (event as CustomEvent<string>).detail;
      navigateSafely(() => {
        if (view === "assistant") { setMobileTab("assistant"); setIsSidebarCollapsed(false); }
        else if (["home", "tasks", "notes", "schedule"].includes(view)) { setMobileTab("dashboard"); setCurrentView(view as DashboardView); }
      });
    };
    window.addEventListener("alfred:tour-navigate", navigate);
    return () => window.removeEventListener("alfred:tour-navigate", navigate);
  }, []);

  const [chatResetSignal, setChatResetSignal] = useState(0);

  const handleNewChat = () => {
    setChatResetSignal((prev) => prev + 1);
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      try {
        saveAccountPreferences({ sidebarCollapsed: false });
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
  }, [handleToggleSidebar]);

  // Listen for tray navigation commands (e.g., Settings) and in-app settings events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupTauriListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("alfred:navigate", (event) => {
          if (event.payload === "settings") {
            navigateSafely(() => { setMobileTab("dashboard"); setCurrentView("settings"); });
          }
        });
      } catch {
        // Fallback for custom events in web environments
      }
    };
    void setupTauriListener();

    const handleLocalSettingsOpen = () => {
      navigateSafely(() => { setMobileTab("dashboard"); setCurrentView("settings"); });
    };
    window.addEventListener("alfred:open_settings", handleLocalSettingsOpen);

    return () => {
      if (unlisten) unlisten();
      window.removeEventListener("alfred:open_settings", handleLocalSettingsOpen);
    };
  }, []);

  const handleGoHome = () => {
    navigateSafely(() => { setCurrentView("home"); setMobileTab("dashboard"); });
  };

  const handleMobileNavigate = (destination: MobileNavDestination) => {
    navigateSafely(() => {
    if (destination === "assistant") {
      setMobileTab("assistant");
    } else {
      setMobileTab("dashboard");
      setCurrentView(destination === "dashboard" ? "home" : destination);
    }
    });
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
        "input, textarea, select, button, [contenteditable], [role='button'], [role='slider'], [role='dialog'], dialog, .dialog-backdrop, .chat-composer-box, .chat-prompt-input-wrapper, .timeline-event-chip"
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
    if (noteOpen) return;
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
        : currentView === "home" ? "dashboard"
        : currentView === "settings" ? "settings" : "workspace";
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
      {!isAndroidDevice && <Header onGoHome={handleGoHome} />}
      <HoldDetails />

      {/* Top Black Header with Alfred Branding (Android/Mobile only, consistent across destinations) */}
      {!isAndroidDevice && <header className="mobile-top-header" role="banner">
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
            <StateControl />
          </div>
        )}
      </header>}

      <ErrorNotice message={error} retry={retry} />
      {loading && !session ? (
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
              key={`${session?.account.id}-${chatResetSignal}`}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={handleToggleSidebar}
              onNewChat={handleNewChat}
              isActiveView={mobileTab === "assistant"}
              onVoiceStateChange={setVoiceHeaderState}
              onOpenSettings={() => {
                navigateSafely(() => { setMobileTab("dashboard"); setCurrentView("settings"); });
              }}
            />
            <Dashboard key={session?.account.id} currentView={currentView} onViewChange={setCurrentView} />
          </main>
          {!noteOpen && <MobileBottomNav
            activeDestination={mobileTab === "assistant" ? "assistant" : currentView === "home" ? "dashboard" : currentView === "settings" ? "settings" : "workspace"}
            onNavigate={handleMobileNavigate}
          />}
        </>
      )}
    </div>
  );
};

export default App;
