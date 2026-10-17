/** No network or AI dependencies: a mounted note owns one URL and one audio element. */
export function attachVoiceNote(element: HTMLAudioElement, blob: Blob, doc = document, win = window) {
  const url = URL.createObjectURL(blob);
  element.src = url;
  const pause = () => element.pause();
  const coordinate = (event: Event) => { if (event.target !== element) pause(); };
  const visibility = () => { if (doc.hidden) pause(); };
  doc.addEventListener("play", coordinate, true);
  doc.addEventListener("visibilitychange", visibility);
  win.addEventListener("pagehide", pause);
  win.addEventListener("alfred:pause-playback", pause);
  return () => {
    pause(); element.removeAttribute("src"); element.load(); URL.revokeObjectURL(url);
    doc.removeEventListener("play", coordinate, true);
    doc.removeEventListener("visibilitychange", visibility);
    win.removeEventListener("pagehide", pause);
    win.removeEventListener("alfred:pause-playback", pause);
  };
}

export async function toggleVoiceNote(element: HTMLAudioElement): Promise<void> {
  if (element.paused) await element.play(); else element.pause();
}
