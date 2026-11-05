import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Keyboard } from "lucide-react";
import { isTauri } from "../../auth/auth.ts";
import { desktopPlatform } from "../../lib/desktopPlatform.ts";
import { overlayShortcut, shortcutFromKey } from "../../lib/overlayShortcut.ts";

const supportsOverlayShortcut = () => isTauri() && desktopPlatform(navigator.userAgent) !== null;

export function OverlayShortcutControls() {
  const { shortcut, busy, error } = useSyncExternalStore(overlayShortcut.subscribe, overlayShortcut.getSnapshot);
  const [recorded, setRecorded] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [inputError, setInputError] = useState("");
  const id = useId();
  const preferred = recorded ?? shortcut?.preferred ?? "Ctrl+Alt+Space";
  const active = shortcut?.status === "active";
  const pending = busy || !shortcut || shortcut.status === "initializing";
  return <>
    <div className="settings-feature-row">
      <div className="settings-feature-info">
        <label htmlFor={id} className="settings-feature-title">Overlay keybind</label>
        <span className="settings-feature-desc">Open or hide Alfred from any app. This setting belongs to this computer.</span>
      </div>
      <button id={id} type="button" className={`settings-action-btn shortcut-recorder${recording ? " is-recording" : ""}`}
        disabled={pending} aria-label={recording ? "Press your overlay keybind" : "Record overlay keybind"}
        onClick={() => { setRecording(true); setInputError(""); }} onBlur={() => setRecording(false)}
        onKeyDown={event => {
          if (!recording) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey) { setRecording(false); return; }
          try {
            const value = shortcutFromKey(event);
            if (value) { setRecorded(value); setRecording(false); setInputError(""); }
          } catch (error) { setInputError(String(error)); }
        }}>
        <Keyboard size={16} />{recording ? "Press keys… (Esc cancels)" : preferred}
      </button>
    </div>
    <p className="settings-feature-desc shortcut-status" role="status" aria-live="polite">
      {pending ? "Checking shortcut settings…" : active ? <>Active shortcut: <strong>{shortcut.effective}</strong></>
        : shortcut.status === "unavailable" ? "The desktop shortcut is unavailable. Try enabling it again or use Keyboard settings."
        : "The global overlay shortcut is off."}
    </p>
    {shortcut?.backend === "portal" && <p className="settings-feature-desc shortcut-status">Your desktop will ask you to approve a global shortcut. It may suggest a different keybind if yours is reserved. Alfred must remain running.</p>}
    <div className="settings-profile-actions shortcut-actions">
      <button type="button" className="settings-action-btn" disabled={pending || recording} onClick={() => void overlayShortcut.configure(preferred)}>
        {busy ? "Waiting for desktop…" : active && shortcut.backend === "portal" ? "Change in desktop…" : active ? "Apply keybind" : "Enable global shortcut…"}
      </button>
      {active && <button type="button" className="settings-action-btn" disabled={pending} onClick={() => void overlayShortcut.configure(preferred, false)}>Disable</button>}
      {desktopPlatform(navigator.userAgent) === "linux" && <button type="button" className="settings-action-btn" disabled={busy} onClick={async () => {
        try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("open_overlay_keyboard_settings"); }
        catch (error) { setInputError(String(error)); }
      }}>Open Keyboard settings</button>}
    </div>
    {shortcut?.backend === "portal" && <p className="settings-feature-desc shortcut-status">If your desktop does not offer approval, add a custom shortcut for <code>alfred --overlay</code> in Keyboard settings.</p>}
    {error && !shortcut && <button type="button" className="settings-action-btn" onClick={() => void overlayShortcut.start()}>Retry shortcut settings</button>}
    {(error || inputError || shortcut?.message) && <p className="settings-save-feedback shortcut-status" role="alert">{error || inputError || shortcut?.message}</p>}
  </>;
}

export function OverlayShortcutSettings() {
  if (!supportsOverlayShortcut()) return null;
  return <section className="settings-card-group">
    <h3 className="settings-group-header"><Keyboard size={16} className="settings-group-icon" />Global overlay shortcut</h3>
    <div className="settings-feature-card"><OverlayShortcutControls /></div>
  </section>;
}

/** One first-run setup prompt, owned by the main WebView, never the overlay. */
export function OverlayShortcutRuntime() {
  const { shortcut, busy } = useSyncExternalStore(overlayShortcut.subscribe, overlayShortcut.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const supported = supportsOverlayShortcut();
  const showSetup = supported && desktopPlatform(navigator.userAgent) === "linux" && shortcut?.status === "unconfigured" && !shortcut.setupDismissed;
  useEffect(() => { if (supported) void overlayShortcut.start(); }, [supported]);
  useEffect(() => {
    if (showSetup && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!showSetup && dialog.current?.open) dialog.current.close();
  }, [showSetup]);
  if (!supported) return null;
  return <dialog ref={dialog} className="alfred-dialog overlay-shortcut-setup" aria-labelledby="shortcut-setup-title"
    onCancel={event => { event.preventDefault(); void overlayShortcut.dismiss(); }}>
    <h2 id="shortcut-setup-title">Open Alfred from anywhere</h2>
    <p>{shortcut?.backend === "portal" ? "Choose an overlay keybind, then approve it in your desktop’s shortcut dialog." : "Choose a keybind to open the floating assistant from any application."}</p>
    <OverlayShortcutControls />
    <button type="button" className="settings-action-btn" disabled={busy} onClick={() => void overlayShortcut.dismiss()}>Set up later</button>
  </dialog>;
}
