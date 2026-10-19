export interface AccountPreferences {
  overlayMode: "quick_input" | "voice";
  silenceTimeout: number;
  launchOnStartup: boolean;
  sidebarCollapsed: boolean;
}
export const defaultPreferences: AccountPreferences = {
  overlayMode: "quick_input", silenceTimeout: 1500, launchOnStartup: false, sidebarCollapsed: false,
};
export function validPreferences(value: unknown): Partial<AccountPreferences> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  return {
    ...(input.overlayMode === "voice" || input.overlayMode === "quick_input" ? { overlayMode: input.overlayMode } : {}),
    ...(typeof input.silenceTimeout === "number" && [1000, 1500, 2000, 2500].includes(input.silenceTimeout) ? { silenceTimeout: input.silenceTimeout } : {}),
    ...(typeof input.launchOnStartup === "boolean" ? { launchOnStartup: input.launchOnStartup } : {}),
    ...(typeof input.sidebarCollapsed === "boolean" ? { sidebarCollapsed: input.sidebarCollapsed } : {}),
  };
}
