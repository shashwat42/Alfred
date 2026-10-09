import { useState } from "react";
import Chat from "./components/Chat";
import Dashboard from "./components/Dashboard";
import type { DashboardView } from "./types/dashboard.ts";
import Header from "./components/Header";
import { useAuth } from "./auth/authContext.ts";

type MobileTab = "assistant" | "dashboard";

const App = () => {
  const { loading, error, retry } = useAuth();
  const [currentView, setCurrentView] = useState<DashboardView>("home");
  const [mobileTab, setMobileTab] = useState<MobileTab>("assistant");

  const handleGoHome = () => {
    setCurrentView("home");
    setMobileTab("dashboard");
  };

  return (
    <div className="App">
      <Header onGoHome={handleGoHome} />

      {/* Mobile view segmented switch bar (hidden on desktop via CSS) */}
      <nav className="mobile-view-nav" role="tablist" aria-label="Mobile navigation">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === "assistant"}
          className={`mobile-view-tab ${mobileTab === "assistant" ? "active" : ""}`}
          onClick={() => setMobileTab("assistant")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          <span>Assistant</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === "dashboard"}
          className={`mobile-view-tab ${mobileTab === "dashboard" ? "active" : ""}`}
          onClick={() => setMobileTab("dashboard")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>Dashboard</span>
        </button>
      </nav>

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
        <main className={`Main mobile-tab-${mobileTab}`}>
          <Chat />
          <Dashboard currentView={currentView} onViewChange={setCurrentView} />
        </main>
      )}
    </div>
  );
};

export default App;
