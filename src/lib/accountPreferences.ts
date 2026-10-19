import { getSession } from "../auth/auth.ts";
import { apiJson } from "./api.ts";
import { cloudSyncEnabled } from "./localWorkspace.ts";
import { defaultPreferences, validPreferences, type AccountPreferences } from "../../Alfred_Backend/src/workspace/preferences.ts";

export const PREFERENCES_CHANGED_EVENT = "alfred:preferences-changed";
const key = (id: string) => `alfred_preferences_${id}`;
interface Cached { values: AccountPreferences; pending: Partial<AccountPreferences> }
function read(id: string): Cached {
  try {
    const saved = JSON.parse(localStorage.getItem(key(id)) || "null");
    // Claim legacy device preferences once, so another account cannot inherit them.
    if (!saved && !localStorage.getItem("alfred_preferences_legacy_owner")) {
      const legacy = validPreferences({
        overlayMode: localStorage.getItem("alfred_overlay_mode"),
        silenceTimeout: Number(localStorage.getItem("alfred_silence_threshold_ms")),
        ...(localStorage.getItem("alfred_sidebar_collapsed") !== null ? { sidebarCollapsed: localStorage.getItem("alfred_sidebar_collapsed") === "true" } : {}),
      });
      if (Object.keys(legacy).length) {
        const migrated = { values: { ...defaultPreferences, ...legacy }, pending: legacy };
        localStorage.setItem("alfred_preferences_legacy_owner", id);
        localStorage.setItem(key(id), JSON.stringify(migrated));
        return migrated;
      }
    }
    return { values: { ...defaultPreferences, ...validPreferences(saved?.values) }, pending: validPreferences(saved?.pending) };
  } catch { return { values: { ...defaultPreferences }, pending: {} }; }
}
export function getAccountPreferences(): AccountPreferences {
  const id = getSession()?.account.id;
  return id ? read(id).values : { ...defaultPreferences };
}
function announce(id: string) {
  window.dispatchEvent(new CustomEvent(PREFERENCES_CHANGED_EVENT, { detail: { accountId: id } }));
}
export function saveAccountPreferences(patch: Partial<AccountPreferences>): void {
  const id = getSession()?.account.id;
  if (!id) throw new Error("Open an account before changing preferences.");
  const cached = read(id);
  localStorage.setItem(key(id), JSON.stringify({ values: { ...cached.values, ...patch }, pending: { ...cached.pending, ...patch } }));
  announce(id);
  void syncAccountPreferences(id).catch(() => { /* Pending changes survive offline and retry on reconnect. */ });
}
const inFlight = new Map<string, Promise<void>>();
export function syncAccountPreferences(id: string): Promise<void> {
  if (!cloudSyncEnabled(id) || navigator.onLine === false) return Promise.resolve();
  const running = inFlight.get(id); if (running) return running;
  const request = (async () => {
    // Re-read after each response: edits made during a request must not be lost.
    do {
      const sent = read(id).pending;
      const dirty = Object.keys(sent).length > 0;
      const remote = await apiJson<AccountPreferences>("/api/account/preferences", { _expectedAccountId: id, ...(dirty ? { method: "PATCH", body: JSON.stringify(sent) } : {}) });
      if (getSession()?.account.id !== id) return;
      const latest = read(id);
      const pending = Object.fromEntries(Object.entries(latest.pending).filter(([name, value]) => !dirty || value !== sent[name as keyof AccountPreferences]));
      localStorage.setItem(key(id), JSON.stringify({ values: { ...defaultPreferences, ...validPreferences(remote), ...pending }, pending }));
      announce(id);
    } while (Object.keys(read(id).pending).length && cloudSyncEnabled(id));
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, request); return request;
}
