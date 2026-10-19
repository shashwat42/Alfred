import { apiFetch } from "./api.ts";
import { getSession, isTauri } from "../auth/auth.ts";

export interface ScheduleNotificationPreferences {
  destination: "mobile" | "desktop" | "both";
  enabled: boolean; leadMinutes: number; atStart: boolean; timeZone: string; revision: number;
}
export interface ScheduleReminder {
  key: string; scheduleId: string; date: string; title: string; body: string;
  kind: "lead" | "start"; eventAt: number; dueAt: number;
}
export interface NotificationPlan { preferences: ScheduleNotificationPreferences; reminders: ScheduleReminder[]; next: string | null }
export const NOTIFICATION_SETTINGS_EVENT = "alfred:schedule-notification-settings";
export const NOTIFICATION_OPEN_EVENT = "alfred:open-schedule";
export const NOTIFICATION_TAP_EVENT = "alfred:schedule-notification-tap";
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const notificationPlatform = () => isAndroid() ? (window.AlfredScheduleNotifications ? "mobile" : null) : isTauri() ? "desktop" : null;
let deliveryStatus = "Connecting to schedule notifications…";
const statusListeners = new Set<() => void>();
export const getNotificationDeliveryStatus = () => deliveryStatus;
export function subscribeNotificationDeliveryStatus(listener: () => void) { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; }
export function setNotificationDeliveryStatus(status: string) {
  if (deliveryStatus === status) return;
  deliveryStatus = status; statusListeners.forEach(listener => listener());
}

export function installationSecret(): string {
  const storageKey = "alfred_schedule_notification_installation";
  const existing = localStorage.getItem(storageKey);
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(storageKey, value);
  return value;
}

export async function notificationRequest<T>(path: string, accountId: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T | null> {
  const timeout = AbortSignal.timeout(10_000);
  const response = await apiFetch(`/api/schedule-notifications${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    _preserveAccount: true, _expectedAccountId: accountId,
  });
  if (!response.ok) {
    const err = new Error(response.status === 409 ? "Settings changed on another device. Reloaded the latest settings; please try again." : `Schedule notification request failed (${response.status}).`) as Error & { status?: number };
    err.status = response.status; throw err;
  }
  return response.status === 204 ? null : response.json() as Promise<T>;
}

interface NativeNotifications { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null }
declare global { interface Window { AlfredScheduleNotifications?: NativeNotifications } }
const pending = new Map<string, (value: Record<string, unknown>) => void>();
export function androidNotificationRequest(type: "status" | "permission" | "settings" | "timing" | "configure" | "clear" | "sync" | "openTarget", data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const bridge = window.AlfredScheduleNotifications;
  if (!bridge) return Promise.reject(new Error("Native Android notifications are unavailable in this window."));
  const id = crypto.randomUUID();
  bridge.onmessage = event => {
    try { const value = JSON.parse(event.data); pending.get(value.id)?.(value); } catch { /* Ignore malformed native replies. */ }
  };
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { pending.delete(id); reject(new Error("Android notification service did not respond.")); }, type === "permission" ? 120_000 : 15_000);
    pending.set(id, value => { clearTimeout(timeout); pending.delete(id); if (value.error) reject(new Error(String(value.error))); else resolve(value); });
    try { bridge.postMessage(JSON.stringify({ ...data, id, type })); }
    catch { clearTimeout(timeout); pending.delete(id); reject(new Error("Native Android notifications are unavailable.")); }
  });
}

export async function notificationPermission(request = false): Promise<string> {
  if (isAndroid()) {
    if (!window.AlfredScheduleNotifications) return "unavailable";
    const result = await androidNotificationRequest(request ? "permission" : "status");
    return result.granted ? "granted" : "denied";
  }
  if (!isTauri()) return "unavailable";
  const native = await import("@tauri-apps/plugin-notification");
  if (await native.isPermissionGranted()) return "granted";
  return request ? native.requestPermission() : "denied";
}

export function canOpenNotificationSettings(): boolean {
  const platform = notificationPlatform();
  return platform === "mobile" || (platform === "desktop" && /Windows/i.test(navigator.userAgent));
}

export async function openNotificationSettings(): Promise<void> {
  if (notificationPlatform() === "mobile") { await androidNotificationRequest("settings"); return; }
  if (!canOpenNotificationSettings()) throw new Error("Open notification settings in your operating system.");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl("ms-settings:notifications");
}

export function openScheduleTarget(target: { scheduleId?: unknown; date?: unknown; accountId?: unknown }) {
  if (!/^[a-f0-9]{24}$/.test(String(target.scheduleId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(target.date))) return;
  if (target.accountId && target.accountId !== getSession()?.account.id) return;
  window.dispatchEvent(new CustomEvent(NOTIFICATION_OPEN_EVENT, { detail: target }));
}

export async function deliverDesktopReminder(reminder: ScheduleReminder, accountId: string): Promise<void> {
  if (notificationPlatform() !== "desktop" || getSession()?.account.id !== accountId) return;
  if (await notificationPermission() !== "granted" || getSession()?.account.id !== accountId) return;
  const { invoke } = await import("@tauri-apps/api/core");
  if (getSession()?.account.id !== accountId) return;
  // Same maintained-plugin command as sendNotification, awaited so IPC failures are
  // contained by the coordinator rather than becoming unhandled async rejections.
  await invoke("plugin:notification|notify", { options: {
    title: reminder.title, body: reminder.body,
    // Sound identifiers follow the installed native plugin's platform adapters.
    sound: /Windows/i.test(navigator.userAgent) ? "Default" : /Macintosh|Mac OS X/i.test(navigator.userAgent) ? "Ping" : "message-new-instant",
    extra: { scheduleId: reminder.scheduleId, date: reminder.date, accountId },
  } });
}
