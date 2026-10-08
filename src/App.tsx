import { useState } from "react";
import Chat from "./components/Chat";
import Dashboard, { type DashboardView } from "./components/Dashboard";
import Header from "./components/Header";
import { useAuth } from "./auth/authContext.ts";

const App = () => {
  const { loading, error, retry } = useAuth();
  const [currentView, setCurrentView] = useState<DashboardView>("home");

  return (
    <div className="App">
      <Header onGoHome={() => setCurrentView("home")} />
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
            onClick={() => void retry()}
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
        <main className="Main">
          <Chat />
          <Dashboard currentView={currentView} onViewChange={setCurrentView} />
        </main>
      )}
    </div>
  );
};

export default App;
