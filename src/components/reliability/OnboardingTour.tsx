import { ErrorNotice } from "./Notifications";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, MousePointer2, X } from "lucide-react";
import { AppStateContext } from "./appStateContext";
import "./onboarding.css";

const steps = [
  { label: "WELCOME", title: "Let’s find your way around.", text: "A few small stops to make Alfred feel familiar. Explore your own workspace, or skip the tour anytime.", view: "home", target: "" },
  { label: "YOUR TASKS", title: "Make room for what matters.", text: "Use Add task to capture a to-do, set its priority and keep track of what’s next. Try it now, or carry on with the tour.", view: "tasks", target: '[aria-label="Add to-do item"]' },
  { label: "YOUR NOTES", title: "A place for a passing thought.", text: "Choose New note to start writing. Give it a title, add a few words and save when you’re ready. Your notes are always a tap away.", view: "notes", target: '.notes-gallery-icon-btn.highlight-add-btn' },
  { label: "YOUR SCHEDULE", title: "Give your plans a little space.", text: "Add an event to plan your day. You can choose a time and a reminder; Alfred asks for notification permission when you need it.", view: "schedule", target: '[aria-label="Add schedule item"]' },
  { label: "YOUR ASSISTANT", title: "And when you need a hand…", text: "Type a message to Alfred, or choose voice when you’re ready. Review suggested changes before applying them. You can revisit this tour in Settings.", view: "assistant", target: '.chat-prompt-input-wrapper' },
] as const;
type Highlight = { left: number; top: number; width: number; height: number };

export function Onboarding({ complete, legal, interactive = false }: {
  complete: () => Promise<void>; legal: (page: "privacy" | "terms") => void; interactive?: boolean;
}) {
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const lock = useRef(false), card = useRef<HTMLElement>(null);
  const titleId = useId(), textId = useId();
  const selected = useContext(AppStateContext)?.selected;
  const current = steps[step];
  const finish = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await complete(); window.dispatchEvent(new CustomEvent("alfred:tour-navigate", { detail: "home" })); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save your tour progress. Please retry."); }
    finally { lock.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!interactive || selected) return;
    const focus = requestAnimationFrame(() => card.current?.focus({ preventScroll: true }));
    if (step > 0) window.dispatchEvent(new CustomEvent("alfred:tour-navigate", { detail: current.view }));
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = current.target ? Array.from(document.querySelectorAll<HTMLElement>(current.target)).find(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) : null;
        const rect = target?.getBoundingClientRect();
        const next = rect && rect.top < window.innerHeight && rect.bottom > 0 ? { left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 } : null;
        setHighlight(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      });
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(focus); cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [current, step, interactive, selected]);
  if (interactive && selected) return null;
  return <div className={interactive ? `onboarding-layer ${step === 0 ? "onboarding-centered" : ""} ${current.view === "assistant" ? "onboarding-assistant" : ""}` : "onboarding-example"}>
    {interactive && (highlight && step > 0 ? <div className="onboarding-spotlight" style={highlight} aria-hidden="true" /> : <div className="onboarding-shade" aria-hidden="true" />)}
    <section ref={card} className="onboarding-card" role="dialog" aria-modal={false} aria-labelledby={titleId} aria-describedby={textId} tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); void finish(); } }}>
      <div className="onboarding-copy"><div className="onboarding-topline"><span>{current.label}</span><button onClick={() => void finish()} disabled={busy} aria-label="Skip tour"><X size={18} /></button></div>
        <h2 id={titleId}>{current.title}</h2><p id={textId}>{current.text}</p>
        {step > 0 && <span className="onboarding-hint"><MousePointer2 size={15} />{highlight ? "Try the highlighted control, or choose Next." : "Explore at your own pace."}</span>}
        {step === 0 && <div className="onboarding-legal"><button onClick={() => legal("privacy")}>Privacy Policy</button><span>·</span><button onClick={() => legal("terms")}>Terms of Service</button></div>}
        <ErrorNotice message={error} />
      </div>
      <footer><div className="onboarding-progress"><span>{step + 1} of {steps.length}</span><progress value={step + 1} max={steps.length} aria-label="Tour progress" /></div>
        <div className="onboarding-buttons"><button className="onboarding-skip" disabled={busy} onClick={() => void finish()}>Skip tour</button><div>{step > 0 && <button className="onboarding-back" disabled={busy} onClick={() => setStep(step - 1)} aria-label="Previous step"><ArrowLeft size={17} /></button>}<button className="onboarding-next" disabled={busy} onClick={() => step === steps.length - 1 ? void finish() : setStep(step + 1)}>{busy ? "Saving…" : step === 0 ? "Show me around" : step === steps.length - 1 ? "Start using Alfred" : "Next"}<ArrowRight size={17} /></button></div></div>
      </footer>
    </section>
  </div>;
}
