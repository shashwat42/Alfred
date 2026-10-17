export type DesktopOverlayMode = "quick_input" | "voice";

export const OVERLAY_MODE_STORAGE_KEY = "alfred_overlay_mode";
export const OVERLAY_MODE_CHANGED_EVENT = "alfred:overlay_mode_changed";

/**
 * Gets the current desktop overlay mode from localStorage.
 * Defaults strictly to "quick_input" if unset, invalid, or during storage access errors.
 */
export function getSavedOverlayMode(): DesktopOverlayMode {
  if (typeof window === "undefined") {
    return "quick_input";
  }
  try {
    const saved = localStorage.getItem(OVERLAY_MODE_STORAGE_KEY);
    if (saved === "voice" || saved === "quick_input") {
      return saved;
    }
    return "quick_input";
  } catch {
    return "quick_input";
  }
}

/**
 * Saves the desktop overlay mode preference to localStorage and broadcasts the change.
 */
export function setSavedOverlayMode(mode: DesktopOverlayMode): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(OVERLAY_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent(OVERLAY_MODE_CHANGED_EVENT, { detail: { mode } }));
    return true;
  } catch (err) {
    console.error("Failed to save overlay mode preference:", err);
    return false;
  }
}
