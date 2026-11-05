export interface OverlayShortcutSnapshot {
  backend: "portal" | "native";
  status: "initializing" | "unconfigured" | "active" | "disabled" | "unavailable";
  preferred: string;
  effective: string | null;
  message: string | null;
  setupDismissed: boolean;
}
export interface ShortcutDriver {
  get(): Promise<OverlayShortcutSnapshot>;
  configure(preferred: string, enabled: boolean): Promise<OverlayShortcutSnapshot>;
  dismiss(): Promise<OverlayShortcutSnapshot>;
  watch(changed: (value: OverlayShortcutSnapshot) => void): Promise<() => void>;
}

/** Device-scoped native state: never sync system permissions with an account. */
export class OverlayShortcutController {
  private state: { shortcut: OverlayShortcutSnapshot | null; busy: boolean; error: string } = { shortcut: null, busy: false, error: "" };
  private listeners = new Set<() => void>();
  private starting: Promise<void> | null = null;
  private operation: Promise<void> | null = null;
  private revision = 0;
  private driver: ShortcutDriver;
  constructor(driver: ShortcutDriver) { this.driver = driver; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<typeof this.state>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  start = (): Promise<void> => {
    if (this.starting) return this.starting;
    // This controller and its one native listener live for the main WebView's
    // lifetime. React StrictMode and mounting Settings cannot duplicate prompts.
    let unlisten: (() => void) | undefined;
    this.starting = (async () => {
      unlisten = await this.driver.watch(shortcut => { this.revision++; this.update({ shortcut }); });
      const revision = this.revision;
      const shortcut = await this.driver.get();
      if (revision === this.revision) this.update({ shortcut, error: "" });
    })().catch(error => {
      unlisten?.(); this.starting = null;
      this.update({ error: String(error) });
    });
    return this.starting;
  };
  private run(operation: () => Promise<OverlayShortcutSnapshot>): Promise<void> {
    if (this.operation) return this.operation;
    this.update({ busy: true, error: "" });
    const revision = this.revision;
    this.operation = Promise.resolve().then(operation).then(shortcut => { if (revision === this.revision) this.update({ shortcut }); })
      .catch(error => this.update({ error: String(error) }))
      .finally(() => { this.operation = null; this.update({ busy: false }); });
    return this.operation;
  }
  configure = (preferred: string, enabled = true) => this.run(() => this.driver.configure(preferred, enabled));
  dismiss = () => this.run(() => this.driver.dismiss());
}

const nativeDriver: ShortcutDriver = {
  async get() { const { invoke } = await import("@tauri-apps/api/core"); return invoke("get_overlay_shortcut"); },
  async configure(preferred, enabled) { const { invoke } = await import("@tauri-apps/api/core"); return invoke("configure_overlay_shortcut", { preferred, enabled }); },
  async dismiss() { const { invoke } = await import("@tauri-apps/api/core"); return invoke("dismiss_overlay_shortcut_setup"); },
  async watch(changed) { const { listen } = await import("@tauri-apps/api/event"); return listen<OverlayShortcutSnapshot>("alfred:overlay-shortcut-changed", event => changed(event.payload)); },
};
export const overlayShortcut = new OverlayShortcutController(nativeDriver);

export function shortcutFromKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat">): string | null {
  if (event.repeat || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) throw new Error("Include Ctrl, Alt or Super with your key.");
  const aliases: Record<string, string> = { " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
  const key = aliases[event.key] ?? (/^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : event.key);
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Escape|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/.test(key)) {
    throw new Error("Choose a letter, number, function key or navigation key.");
  }
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super", key].filter(Boolean).join("+");
}
