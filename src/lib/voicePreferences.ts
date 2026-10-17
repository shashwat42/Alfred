export const SILENCE_TIMEOUT_KEY = "alfred_silence_threshold_ms";
export const SILENCE_TIMEOUT_OPTIONS = [1000, 1500, 2000, 2500] as const;

export function getSilenceTimeout(): number {
  try {
    const value = Number(localStorage.getItem(SILENCE_TIMEOUT_KEY));
    return SILENCE_TIMEOUT_OPTIONS.some((option) => option === value) ? value : 1500;
  } catch {
    return 1500;
  }
}

export function saveSilenceTimeout(value: number): void {
  if (!SILENCE_TIMEOUT_OPTIONS.some((option) => option === value)) {
    throw new Error("Choose one of the available pause durations.");
  }
  localStorage.setItem(SILENCE_TIMEOUT_KEY, String(value));
}
