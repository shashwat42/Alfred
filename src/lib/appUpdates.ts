export interface AppUpdate { version: string; notes?: string | null }
export type UpdateProgress = { event: "downloading"; downloaded: number; total: number | null } | { event: "installing" };
export interface UpdateDriver {
  check(): Promise<AppUpdate | null>;
  install(version: string, progress: (value: UpdateProgress) => void): Promise<void>;
}
export interface UpdateSnapshot {
  status: "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "installed";
  update: AppUpdate | null;
  downloaded: number;
  total: number | null;
  error: string;
  lastChecked: number | null;
}

export class AppUpdateController {
  private state: UpdateSnapshot = { status: "idle", update: null, downloaded: 0, total: null, error: "", lastChecked: null };
  private listeners = new Set<() => void>();
  private operation: Promise<void> | null = null;
  private driver: UpdateDriver;
  constructor(driver: UpdateDriver) { this.driver = driver; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(value: Partial<UpdateSnapshot>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  check = (): Promise<void> => {
    if (this.operation) return this.operation;
    this.set({ status: "checking", error: "" });
    this.operation = Promise.resolve().then(() => this.driver.check()).then(update => {
      this.set({ status: update ? "available" : "current", update, lastChecked: Date.now(), downloaded: 0, total: null });
    }).catch(error => {
      this.set({ status: this.state.update ? "available" : "idle", error: error instanceof Error ? error.message : String(error) });
    }).finally(() => { this.operation = null; });
    return this.operation;
  };
  install = (): Promise<void> => {
    if (this.operation) return this.operation;
    if (!this.state.update) return Promise.resolve();
    const version = this.state.update.version;
    this.set({ status: "downloading", downloaded: 0, total: null, error: "" });
    this.operation = Promise.resolve().then(() => this.driver.install(version, progress => {
      if (progress.event === "installing") this.set({ status: "installing" });
      else this.set({ downloaded: progress.downloaded, total: progress.total });
    })).then(() => this.set({ status: "installed" })).catch(error => {
      this.set({ status: "available", error: error instanceof Error ? error.message : String(error) });
    }).finally(() => { this.operation = null; });
    return this.operation;
  };
}

const nativeDriver: UpdateDriver = {
  async check() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppUpdate | null>("check_for_app_update");
  },
  async install(version, progress) {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<UpdateProgress>();
    channel.onmessage = progress;
    await invoke("install_app_update", { version, onProgress: channel });
  },
};
export const appUpdates = new AppUpdateController(nativeDriver);
export const supportsAppUpdates = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  && /Windows/i.test(navigator.userAgent);
