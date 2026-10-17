export type WindowSurface = "app" | "desktop-overlay" | "android-assistant";

export function resolveWindowSurface(search: string, hash: string, isAndroid: boolean): WindowSurface {
  const requested = new URLSearchParams(search).get("window");
  if (requested === "android-assistant") return "android-assistant";
  const desktopOverlay = requested === "overlay" || new URLSearchParams(hash.replace(/^#/, "")).get("window") === "overlay";
  return desktopOverlay && !isAndroid ? "desktop-overlay" : "app";
}
