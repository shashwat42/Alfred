import { useEffect, useState } from "react";
import { AlertCircle, Check, LoaderCircle, Terminal, X } from "lucide-react";
import "./appStateToasts.css";
import { WelcomeScreen } from "../components/reliability/WelcomeScreen";

const states = [
  "Preview Loading Animation", "Session Expired", "Sync Error", "Body Fetch Error",
  "Simulate Timeout UI", "Database Error", "Simulate Background Task", "Start Screen",
];
const errors: Record<string, { title: string; message: string }> = {
  "Session Expired": { title: "Session expired", message: "Your session needs to be restored. Try again to continue." },
  "Sync Error": { title: "Couldn’t sync your changes", message: "Sync failed. Please try again shortly." },
  "Body Fetch Error": { title: "Couldn’t load content", message: "The requested content couldn’t be fetched. Please try again." },
  "Simulate Timeout UI": { title: "Request timed out", message: "Alfred took too long to respond. Please try again." },
  "Database Error": { title: "Database unavailable", message: "Alfred couldn’t connect to the database. Please try again shortly." },
};

export function AppStateSelector({ state, onChange }: { state: string; onChange: (state: string) => void }) {
  return <span className={`app-state-control ${state ? "is-active" : ""}`}>
    <Terminal size={17} strokeWidth={2} aria-hidden="true" />
    <select className="app-state-select" aria-label="App state" title={`Developer states · ${state || "Normal"}`} value={state} onChange={event => onChange(event.target.value)} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} data-tauri-drag-region="false">
    <option value="">Normal</option>
    {states.map(item => <option key={item}>{item}</option>)}
    </select>
  </span>;
}

export default function AppStateToast({ state, onChange }: { state: string; onChange: (state: string) => void }) {
  const [completed, setCompleted] = useState(false);
  const [startMessage, setStartMessage] = useState("");
  useEffect(() => {
    if (state !== "Simulate Background Task") return;
    const timer = window.setTimeout(() => setCompleted(true), 3500);
    return () => window.clearTimeout(timer);
  }, [state]);
  if (state === "Start Screen") return <div data-simulated="true"><WelcomeScreen guest={() => onChange("")} google={() => setStartMessage("Google sign-in is not started from this development screen. Choose Normal to return to your account.")} message={startMessage || undefined} /></div>;
  const error = errors[state];
  const loading = state === "Preview Loading Animation" || (state === "Simulate Background Task" && !completed);
  const title = error?.title ?? (state === "Preview Loading Animation" ? "Loading Alfred…" : completed ? "Background task completed" : "Background task running…");
  const message = error?.message ?? (state === "Preview Loading Animation" ? "Getting things ready." : completed ? "The simulated task has finished." : "Alfred is working in the background.");
  return <div className="app-state-toast-region" data-simulated="true">
    <section className={`app-state-toast ${error ? "is-error" : ""}`} role={error ? "alert" : "status"} aria-atomic="true">
      {error ? <AlertCircle size={18} aria-hidden="true" /> : loading ? <LoaderCircle className="app-state-toast-spinner" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
      <div><strong>{title}</strong><p>{message}</p><span className="app-state-toast-caption">Simulated state</span></div>
      <button type="button" onClick={() => onChange("")} aria-label="Dismiss notification"><X size={16} /></button>
    </section>
  </div>;
}
