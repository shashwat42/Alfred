import { useState } from "react";
import { RotateCw } from "lucide-react";
import { useAuth } from "../../auth/authContext";
import Logo from "../../assets/Alfred_Logo.svg";
import "./recovery.css";

export function SessionRecovery({ message }: { message: string }) {
  const { continueAsGuest, retry, loginWithGoogle, loading } = useAuth();
  const [stage, setStage] = useState<"retry" | "login">("retry");
  const [busy, setBusy] = useState<"guest" | "google" | null>(null);
  const [actionError, setActionError] = useState("");
  const [retried, setRetried] = useState(false);
  const [awaitingGoogle, setAwaitingGoogle] = useState(false);
  const disabled = Boolean(busy || loading);
  async function login(method: "guest" | "google") {
    setBusy(method); setActionError(""); setAwaitingGoogle(false);
    try {
      if (method === "guest") await continueAsGuest();
      else { await loginWithGoogle(); setAwaitingGoogle(true); }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not sign in. Please try again.");
    } finally { setBusy(null); }
  }
  return <main className="recovery-screen" aria-labelledby="session-recovery-title">
    <div className="recovery-content">
      <img className="recovery-logo" src={Logo} alt="Alfred" width="100" height="100" />
      <h1 id="session-recovery-title">{stage === "retry" ? "Your session has expired" : "Welcome back to Alfred"}</h1>
      <div className="recovery-actions" aria-busy={disabled}>
        {stage === "retry" ? <>
          <button type="button" className="recovery-primary" disabled={disabled} onClick={() => { setRetried(true); setActionError(""); retry(); }}><RotateCw size={16} aria-hidden="true" />{loading ? "Trying again…" : "Retry"}</button>
          <button type="button" className="recovery-link" disabled={disabled} onClick={() => { setStage("login"); setActionError(""); }}>Login Again</button>
        </> : <>
          <button type="button" className="recovery-primary" disabled={disabled} onClick={() => void login("guest")}>{busy === "guest" ? "Continuing…" : "Continue as guest"}</button>
          <button type="button" className="recovery-google" disabled={disabled} onClick={() => void login("google")}><span className="recovery-google-letter" aria-hidden="true">G</span>{busy === "google" ? "Opening Google…" : "Continue with Google"}</button>
          <button type="button" className="recovery-link" disabled={disabled} onClick={() => { setStage("retry"); setRetried(false); setActionError(""); setAwaitingGoogle(false); }}>Back to recovery</button>
        </>}
      </div>
      {awaitingGoogle && <p className="recovery-feedback" role="status">Finish signing in with Google in your browser.</p>}
      {!loading && (actionError || (retried && stage === "retry" && message)) && <p className="recovery-feedback recovery-error" role="alert">{actionError || message}</p>}
    </div>
  </main>;
}
