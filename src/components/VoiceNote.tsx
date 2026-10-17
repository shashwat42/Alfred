import { useEffect, useRef, useState } from "react";
import { attachVoiceNote, toggleVoiceNote } from "../lib/audioPlayback.ts";
import { Play, Pause } from "lucide-react";
import type { RecordingResult } from "../types/audio.ts";
import { getAudioWaveform, WAVEFORM_BARS } from "../lib/audioWaveform.ts";
import "./VoiceNote.css";

/** The message owns the Blob; the mounted player owns its temporary URL. */
export function VoiceNote({ recording }: { recording: RecordingResult }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  useEffect(() => {
    return attachVoiceNote(audio.current!, recording.audio);
  }, [recording]);
  useEffect(() => {
    let disposed = false;
    void getAudioWaveform(recording.audio).then((peaks) => {
      if (!disposed) setWaveform(peaks);
    }).catch(() => { /* Waveform failure must not prevent local playback. */ });
    return () => { disposed = true; };
  }, [recording]);
  const seconds = Math.round(recording.durationMs / 1000);
  return <span className="voice-note">
    <audio ref={audio} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError(true)} onTimeUpdate={(event) => {
      const element = event.currentTarget;
      const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : recording.durationMs / 1000;
      setProgress(duration > 0 ? Math.min(1, element.currentTime / duration) : 0);
    }} />
    <button type="button" className="voice-note-toggle" aria-label={playing ? "Pause voice note" : "Play voice note"} disabled={error} onClick={() => {
      void toggleVoiceNote(audio.current!).catch(() => setError(true));
    }}>
      {playing ? <Pause size={15} /> : <Play size={15} />}
      <svg className="voice-note-waveform" viewBox="0 0 144 28" preserveAspectRatio="none" aria-hidden="true">
        {Array.from({ length: WAVEFORM_BARS }, (_, index) => {
          const height = (waveform?.[index] ?? .1) * 26;
          return <rect key={index} className={`voice-note-bar${progress > index / WAVEFORM_BARS ? " is-played" : ""}`} x={index * 4 + .5} y={(28 - height) / 2} width={2.5} height={height} rx={1.25} />;
        })}
      </svg>
    </button>
    <span className="voice-note-duration">{error ? "Audio unavailable" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>
  </span>;
}
