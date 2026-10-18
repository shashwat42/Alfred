import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, X } from "lucide-react";
import { AppStateContext } from "./appStateContext";
import "./notifications.css";

type Notice = { owner: string; message: string; title: string; retry?: () => void };
type Toast = { key: string; notice: Notice; dismissed: boolean };
const notices = new Map<string, Map<string, Notice>>();
const dismissed = new Set<string>();
const listeners = new Set<() => void>();
const empty: Toast[] = [];
let snapshot = empty;
function publish() {
  snapshot = Array.from(notices, ([key, owners]) => {
    const entries = [...owners.values()];
    const latest = entries.at(-1)!;
    return { key, notice: { ...latest, retry: entries.reverse().find(entry => entry.retry)?.retry }, dismissed: dismissed.has(key) };
  });
  listeners.forEach(listener => listener());
}
function register(notice: Notice) {
  const key = `${notice.title}\n${notice.message}`;
  const owners = notices.get(key) ?? new Map<string, Notice>();
  if (!notices.has(key)) { notices.set(key, owners); dismissed.delete(key); }
  owners.set(notice.owner, notice); publish();
  return () => {
    owners.delete(notice.owner);
    if (!owners.size) { notices.delete(key); dismissed.delete(key); }
    publish();
  };
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// Error presenters reserve no layout space. Matching errors share one toast.
export function ErrorNotice({ message, retry, title = "Something went wrong" }: { message?: string | null; retry?: () => void; title?: string }) {
  const owner = useId(), action = useRef(retry);
  const hasRetry = Boolean(retry);
  const selected = useContext(AppStateContext)?.selected;
  useEffect(() => { action.current = retry; }, [retry]);
  useEffect(() => {
    if (!message || selected) return;
    return register({ owner, title, message, retry: hasRetry ? () => action.current?.() : undefined });
  }, [owner, title, message, selected, hasRetry]);
  return null;
}

export function NotificationHost() {
  const toasts = useSyncExternalStore(subscribe, () => snapshot, () => empty);
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    const update = () => {
      const dialogs = document.querySelectorAll("dialog[open]");
      setTarget(dialogs.item(dialogs.length - 1) ?? document.body);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  if (!target) return null;
  return createPortal(<div className="alfred-notifications" aria-label="Notifications">{toasts.filter(toast => !toast.dismissed).slice(-3).map(({ key, notice }) => <section className="alfred-error-toast" role="alert" aria-atomic="true" key={key}>
    <AlertCircle size={15} aria-hidden="true" /><div><strong>{notice.title}</strong><p>{notice.message}</p>{notice.retry && <button className="alfred-toast-retry" type="button" onClick={notice.retry}>Retry</button>}</div>
    <button className="alfred-toast-dismiss" type="button" aria-label="Dismiss notification" onClick={() => { dismissed.add(key); publish(); }}><X size={15} /></button>
  </section>)}</div>, target);
}
