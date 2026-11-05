/** Android user agents also contain Linux; keep native desktop commands out of it. */
export function desktopPlatform(userAgent: string): "windows" | "linux" | null {
  if (/Android/i.test(userAgent)) return null;
  if (/Windows/i.test(userAgent)) return "windows";
  return /Linux/i.test(userAgent) ? "linux" : null;
}
