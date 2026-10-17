import { API_BASE_URL, AUTH_STORAGE_KEY, dispatchAuthChange, getSession, type AuthSession } from "../auth/auth.ts";
import { androidNotificationRequest, deliverDesktopReminder, installationSecret, isAndroid, notificationPermission, notificationPlatform, notificationRequest, NOTIFICATION_SETTINGS_EVENT, NOTIFICATION_TAP_EVENT, openScheduleTarget, setNotificationDeliveryStatus, type NotificationPlan, type ScheduleReminder } from "./scheduleNotifications.ts";

/** Exactly one coordinator: mounted only in the normal main document, never overlays. */
export function startScheduleNotificationCoordinator(session: AuthSession | null) {
    const changed = (event: StorageEvent) => { if (event.key === AUTH_STORAGE_KEY) dispatchAuthChange(getSession()); };
    // Android already installs its shared account bridge.
    if (!isAndroid()) window.addEventListener("storage", changed);
    const stopAccountSync = () => window.removeEventListener("storage", changed);
    const platform = notificationPlatform();
    if (!session || !platform) return stopAccountSync;
    const accountId = session.account.id;
    setNotificationDeliveryStatus("Connecting to schedule notifications…");
    const controller = new AbortController();
    let stopped = false, busy = false, registered = false;
    let secret: string;
    try { secret = installationSecret(); } catch { return stopAccountSync; }
    let actionListener: { unregister: () => Promise<void> } | undefined;
    const stillCurrent = () => !stopped && getSession()?.token === session.token;
    if (platform === "desktop") {
      void import("@tauri-apps/plugin-notification").then(async native => {
        const listener = await native.onAction(async event => {
          if (!stillCurrent()) return;
          const extra = event.notification?.extra;
          if (!extra || extra.accountId !== accountId) return;
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          await win.show(); await win.unminimize(); await win.setFocus();
          openScheduleTarget(extra);
        });
        if (stopped) await listener.unregister(); else actionListener = listener;
      }).catch(() => { /* Permission/status controls expose unsupported native APIs. */ });
    }
    const tick = async () => {
      if (!stillCurrent() || busy) return;
      busy = true;
      try {
        if (!registered) {
          await notificationRequest("/devices", accountId, { secret, platform }, "POST", controller.signal);
          if (!stillCurrent()) return;
          if (isAndroid()) {
            await androidNotificationRequest("configure", { baseUrl: API_BASE_URL, token: session.token, secret, accountId });
            const target = await androidNotificationRequest("openTarget");
            if (stillCurrent()) openScheduleTarget(target);
          }
          registered = true;
        }
        if (isAndroid()) {
          const status = await androidNotificationRequest("sync");
          if (!status.configured) registered = false;
          if (stillCurrent()) setNotificationDeliveryStatus(status.configured ? "Native schedule sync is active." : "Schedule sync needs an active sign-in session.");
          return;
        }
        if (await notificationPermission() !== "granted") { setNotificationDeliveryStatus("Waiting for notification permission on this device."); return; }
        let cursor: string | null = null;
        do {
          const page: NotificationPlan | null = await notificationRequest<NotificationPlan>("/sync", accountId, { secret, ...(cursor ? { cursor } : {}) }, "POST", controller.signal);
          if (!page || !stillCurrent()) return;
          for (const reminder of page.reminders) {
            if (!stillCurrent()) return;
            if (reminder.dueAt > Date.now()) continue;
            const claimed = await notificationRequest<ScheduleReminder>("/claim", accountId, { secret, key: reminder.key }, "POST", controller.signal);
            if (claimed && stillCurrent()) await deliverDesktopReminder(claimed, accountId);
          }
          cursor = page.next;
        } while (cursor && stillCurrent());
        if (stillCurrent()) setNotificationDeliveryStatus("Schedule notification service is connected.");
      } catch (e) {
        if ((e as { status?: number }).status === 403) registered = false;
        if (stillCurrent()) setNotificationDeliveryStatus("Schedule sync is unavailable. Alfred will retry automatically.");
        // Retry next tick. Never log session/device credentials or event content.
      } finally { busy = false; }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 15_000);
    const refresh = () => { void tick(); };
    const tap = () => { void androidNotificationRequest("openTarget").then(target => { if (stillCurrent()) openScheduleTarget(target); }).catch(() => {}); };
    window.addEventListener(NOTIFICATION_TAP_EVENT, tap);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener(NOTIFICATION_SETTINGS_EVENT, refresh);
    window.addEventListener("alfred:action_executed", refresh);
    return () => {
      if (stopped) return;
      stopAccountSync();
      stopped = true; controller.abort(); window.clearInterval(timer);
      window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh);
      window.removeEventListener(NOTIFICATION_TAP_EVENT, tap);
      window.removeEventListener(NOTIFICATION_SETTINGS_EVENT, refresh); window.removeEventListener("alfred:action_executed", refresh);
      void actionListener?.unregister();
      // StrictMode cleanup must not remove the next registration for the same session.
      if (getSession()?.token !== session.token) {
        void fetch(`${API_BASE_URL}/api/schedule-notifications/devices`, { method: "DELETE", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" }, body: JSON.stringify({ secret }) }).catch(() => {});
        if (isAndroid()) void androidNotificationRequest("clear").catch(() => {});
      }
    };
}
