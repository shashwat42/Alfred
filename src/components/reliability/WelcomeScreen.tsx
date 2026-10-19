import { ErrorNotice } from "./Notifications";
import { useRef, useState } from "react";
import { ArrowRight, CalendarDays, Check, CheckSquare, FileText, ShieldCheck } from "lucide-react";
import Logo from "../../assets/Alfred_Logo.svg";
import Header from "../Header";
import { Legal } from "./Legal";
import { Modal } from "./States";
import { StateControl } from "./StateControl";
import "./welcome.css";

export function WelcomeScreen({ guest, google, message, errorMessage, embedded = false, onLegal }: {
  guest: () => void | Promise<void>; google: () => void | Promise<void>; message?: string; embedded?: boolean;
  onLegal?: (page: "privacy" | "terms") => void;
  errorMessage?: string;
}) {
  const [busy, setBusy] = useState<"guest" | "google" | null>(null);
  const [error, setError] = useState("");
  const [legal, setLegal] = useState<"privacy" | "terms" | null>(null);
  const lock = useRef(false);
  const choose = async (choice: "guest" | "google") => {
    if (lock.current) return;
    lock.current = true; setBusy(choice); setError("");
    try { await (choice === "guest" ? guest() : google()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect. Please try again."); }
    finally { lock.current = false; setBusy(null); }
  };
  return <main className={`welcome-screen ${embedded ? "welcome-embedded" : ""}`}>
    {!embedded && !/Android/i.test(navigator.userAgent) && <Header />}
    <div className="welcome-layout">
      <section className="welcome-story" aria-label="About Alfred">
        <div className="welcome-brand"><img src={Logo} alt="" /><span>ALFRED</span>{!embedded && <StateControl />}</div>
        <div className="welcome-intro"><span className="welcome-eyebrow"><i />A LITTLE MORE HEADSPACE</span>
          <h1>Your day.<br />A little lighter.</h1>
          <p>A place for your plans, your thoughts,<br className="welcome-desktop-break" /> and everything you want to get done.</p>
          <div className="welcome-tools" aria-label="Alfred tools"><span><CheckSquare size={17} />Tasks</span><span><FileText size={17} />Notes</span><span><CalendarDays size={17} />Schedule</span></div>
        </div>
        <div className="welcome-note"><span className="welcome-note-icon"><Check size={20} /></span><div><strong>A little structure. A little breathing room.</strong><p>Let Alfred help with the everyday.</p></div></div>
        <span className="welcome-story-footer">Made for the way your day unfolds.</span>
      </section>
      <section className="welcome-entry" aria-labelledby="welcome-title">
        <div className="welcome-entry-content"><span className="welcome-eyebrow">WELCOME TO ALFRED</span>
          <h2 id="welcome-title">Make yourself at home.</h2>
          <p>Bring your Google account, or start as a guest.<br />Either way, there’s room for you here.</p>
          <div className="welcome-actions">
            <button className="welcome-primary" disabled={busy !== null} onClick={() => void choose("google")}><span className="welcome-google-mark" aria-hidden="true">G</span>{busy === "google" ? "Opening Google…" : "Continue with Google"}</button>
            <div className="welcome-divider"><span>or</span></div>
            <button className="welcome-secondary" disabled={busy !== null} onClick={() => void choose("guest")}>{busy === "guest" ? "Getting things ready…" : "Continue as guest"}<ArrowRight size={18} /></button>
          </div>
          <ErrorNotice message={error || errorMessage} />
          {message && <p className="welcome-feedback" role="status">{message}</p>}
          <p className="welcome-guest-hint">No sign-in needed to get started.<br />You can connect Google later in Settings.</p>
          <div className="welcome-reassurance"><ShieldCheck size={18} /><span>Your session stays saved on this device.</span></div>
          <div className="welcome-legal"><button onClick={() => (onLegal ?? setLegal)("terms")}>Terms of Service</button><span>·</span><button onClick={() => (onLegal ?? setLegal)("privacy")}>Privacy Policy</button></div>
        </div>
        <span className="welcome-entry-footer">A calmer place to begin.</span>
      </section>
    </div>
    {legal && <Modal title={legal === "privacy" ? "Privacy Policy" : "Terms of Service"} onClose={() => setLegal(null)}><Legal page={legal} /></Modal>}
  </main>;
}
