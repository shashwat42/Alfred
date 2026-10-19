import { getAccountPreferences, saveAccountPreferences } from "./accountPreferences.ts";
export const SILENCE_TIMEOUT_KEY = "alfred_silence_threshold_ms";
export const SILENCE_TIMEOUT_OPTIONS = [1000, 1500, 2000, 2500] as const;

export function getSilenceTimeout(): number {
  return getAccountPreferences().silenceTimeout;
}

export function saveSilenceTimeout(value: number): void {
  if (!SILENCE_TIMEOUT_OPTIONS.some((option) => option === value)) {
    throw new Error("Choose one of the available pause durations.");
  }
  saveAccountPreferences({ silenceTimeout: value });
}
