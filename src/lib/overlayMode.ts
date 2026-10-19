import { getAccountPreferences, saveAccountPreferences } from "./accountPreferences.ts";
export type DesktopOverlayMode = "quick_input" | "voice";

export const OVERLAY_MODE_STORAGE_KEY = "alfred_overlay_mode";
export const OVERLAY_MODE_CHANGED_EVENT = "alfred:overlay_mode_changed";

/**
 * Gets the current account’s overlay preference from its offline cache.
 * Defaults strictly to "quick_input" if unset, invalid, or during storage access errors.
 */
export function getSavedOverlayMode(): DesktopOverlayMode {
  if (typeof window === "undefined") {
    return "quick_input";
  }
  try {
    const saved = getAccountPreferences().overlayMode;
    if (saved === "voice" || saved === "quick_input") {
      return saved;
    }
    return "quick_input";
  } catch {
    return "quick_input";
  }
}

/**
 * Saves this account’s overlay preference and broadcasts the change.
 */
export function setSavedOverlayMode(mode: DesktopOverlayMode): boolean {
  if (typeof window === "undefined") return false;
  try {
    saveAccountPreferences({ overlayMode: mode });
    window.dispatchEvent(new CustomEvent(OVERLAY_MODE_CHANGED_EVENT, { detail: { mode } }));
    return true;
  } catch (err) {
    console.error("Failed to save overlay mode preference:", err);
    return false;
  }
}
