import { useEffect, useState } from "react";

/** Long press and keyboard focus expose the same descriptions as desktop titles. */
export function HoldDetails() {
  const [text, setText] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let origin: { x: number; y: number } | undefined;
    let held = false;
    const cancel = () => { clearTimeout(timer); origin = undefined; };
    const start = (event: PointerEvent) => {
      cancel(); held = false;
      const target = (event.target as Element).closest<HTMLElement>("[data-details], [title]");
      if (!target || (event.target as Element).closest("input,textarea,[contenteditable]")) return;
      origin = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { held = true; setText(target.dataset.details || target.title); }, 550);
    };
    const move = (event: PointerEvent) => { if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel(); };
    const click = (event: MouseEvent) => { if (held) { event.preventDefault(); event.stopPropagation(); held = false; } else setText(""); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setText(""); };
    const focus = (event: FocusEvent) => { const element = event.target as HTMLElement; if (element.matches?.(":focus-visible")) setText(element.dataset.details || element.title || ""); };
    window.addEventListener("pointerdown", start); window.addEventListener("pointermove", move); window.addEventListener("pointerup", cancel); window.addEventListener("pointercancel", cancel);
    window.addEventListener("click", click, true); window.addEventListener("keydown", key); window.addEventListener("focusin", focus);
    return () => { cancel(); window.removeEventListener("pointerdown", start); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", cancel); window.removeEventListener("pointercancel", cancel); window.removeEventListener("click", click, true); window.removeEventListener("keydown", key); window.removeEventListener("focusin", focus); };
  }, []);
  useEffect(() => { if (!text) return; const timer = setTimeout(() => setText(""), 5000); return () => clearTimeout(timer); }, [text]);
  return text ? <div className="hold-details" role="status">{text}</div> : null;
}
