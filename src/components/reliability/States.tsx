import { useContext, useEffect, useRef, type ReactNode } from "react";
import { AppStateContext } from "./appStateContext";
import Logo from "../../assets/Alfred_Logo.svg";
import { ErrorNotice } from "./Notifications";
import { CalendarDays, NotebookPen, ListChecks } from "lucide-react";

export function Loader({ label = "Loading Alfred…", overlay = false }: { label?: string; overlay?: boolean }) {
  return <div className={`alfred-loader${overlay ? " alfred-loader-overlay" : ""}`} role="status" aria-live="polite"><span className="tuxedo-loader" aria-hidden="true"><i className="tuxedo-lapel left" /><i className="tuxedo-lapel right" /><i className="tuxedo-bow" />{[0, 1, 2].map(index => <i key={index} className="tuxedo-button" style={{ animationDelay: `${index * .25}s`, top: 24 + index * 8 }} />)}</span>{label}</div>;
}
export function StateCard({ title, children, action, onAction, error = false }: { title: string; children?: ReactNode; action?: string; onAction?: () => void; error?: boolean }) {
  if (error) return <ErrorNotice title={title} message={typeof children === "string" ? children : title} retry={onAction} />;
  return <section className="alfred-state" role="status"><img src={Logo} width="46" height="46" alt="" /><h2>{title}</h2><div>{children}</div>{action && <button type="button" onClick={onAction}>{action}</button>}</section>;
}
export function EmptyState({ section = "dashboard" }: { section?: string }) {
  const Illustration = section === "tasks" ? ListChecks : section === "notes" ? NotebookPen : CalendarDays;
  return <StateCard title={section === "dashboard" ? "Your dashboard is clear" : `No ${section} yet`}><Illustration size={44} className="empty-illustration" aria-hidden="true" /><p>{section === "tasks" ? "Add a task when something needs your attention." : section === "notes" ? "Capture a thought with New note." : "Make room for your next plan."}</p></StateCard>;
}
export function NotFound({ goHome = () => { window.location.href = "/"; } }: { goHome?: () => void }) {
  return <StateCard title="404 · A little off course" action="Return to Alfred" onAction={goHome}>This page could not be found.</StateCard>;
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <ErrorNotice message={message} retry={retry} />;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const selectedState = useContext(AppStateContext)?.selected;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; if (!element || selectedState) return; element.showModal(); return () => element.close(); }, [selectedState]);
  if (selectedState) return null;
  return <dialog ref={dialog} className="alfred-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>{children}</dialog>;
}
