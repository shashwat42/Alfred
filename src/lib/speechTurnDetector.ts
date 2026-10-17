import type { AudioRecorderConfig } from "../types/audio.ts";

type TurnConfig = Pick<AudioRecorderConfig, "speechThreshold" | "silenceDurationMs" | "minSpeechDurationMs">;

/** Counts audible activity, rather than counting silent gaps as speech. */
export class SpeechTurnDetector {
  private readonly threshold: number;
  private readonly silenceMs: number;
  private readonly minimumSpeechMs: number;
  private previousAt: number | null = null;
  private previousSpeech = false;
  private speechMs = 0;
  private lastSpeechAt: number | null = null;
  private finished = false;

  constructor(config: TurnConfig = {}) {
    this.threshold = config.speechThreshold ?? 0.035;
    this.silenceMs = config.silenceDurationMs ?? 1500;
    this.minimumSpeechMs = config.minSpeechDurationMs ?? 120;
  }

  update(rms: number, now: number): boolean {
    if (this.finished) return false;
    // A delayed animation frame must not turn a microphone click into a long word.
    const frameMs = this.previousAt === null ? 0 : Math.min(100, Math.max(0, now - this.previousAt));
    const speech = rms >= this.threshold;
    this.previousAt = now;
    if (speech) {
      if (this.previousSpeech) this.speechMs += frameMs;
      this.lastSpeechAt = now;
    }
    this.previousSpeech = speech;
    if (speech || this.lastSpeechAt === null || now - this.lastSpeechAt < this.silenceMs) return false;
    if (this.speechMs >= this.minimumSpeechMs) {
      this.finished = true;
      return true;
    }
    // Forget isolated noise after a pause; separate clicks cannot accumulate forever.
    this.speechMs = 0;
    this.lastSpeechAt = null;
    return false;
  }
}
