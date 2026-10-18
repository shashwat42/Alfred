import { Loader } from "../reliability/States";
import { ErrorNotice } from "../reliability/Notifications";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "../../auth/authContext.ts";
import { getSession } from "../../auth/auth.ts";
import { androidNotificationRequest, canOpenNotificationSettings, openNotificationSettings, getNotificationDeliveryStatus, subscribeNotificationDeliveryStatus, isAndroid, notificationPermission, notificationPlatform, notificationRequest, NOTIFICATION_SETTINGS_EVENT, type ScheduleNotificationPreferences } from "../../lib/scheduleNotifications.ts";

export function ScheduleNotificationSettings() {
  const { session } = useAuth();
  return <ScheduleNotificationSettingsForm key={session?.account.id ?? "signed-out"} accountId={session?.account.id} />;
}

function ScheduleNotificationSettingsForm({ accountId }: { accountId: string | undefined }) {
  const [value, setValue] = useState<ScheduleNotificationPreferences | null>(null);
  const [permission, setPermission] = useState("checking");
  const [exactAlarms, setExactAlarms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [permissionAction, setPermissionAction] = useState<"request" | "settings" | null>(null);
  const deliveryStatus = useSyncExternalStore(subscribeNotificationDeliveryStatus, getNotificationDeliveryStatus);
  const saving = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!accountId || saving.current) return;
    const requestGeneration = ++generation.current;
    try {
      const saved = await notificationRequest<ScheduleNotificationPreferences>("/preferences", accountId);
      if (getSession()?.account.id === accountId && !saving.current && requestGeneration === generation.current) { setValue(saved); setError(""); }
    } catch { if (getSession()?.account.id === accountId && requestGeneration === generation.current) setError("Could not load schedule notification settings. Please retry."); }
  }, [accountId]);
  const checkPermission = useCallback(() => {
    void notificationPermission().then(setPermission).catch(() => setPermission("unavailable"));
    if (isAndroid()) void androidNotificationRequest("status").then(status => setExactAlarms(Boolean(status.exactAlarms))).catch(() => setExactAlarms(false));
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); checkPermission(); }, 0);
    const timer = setInterval(() => { void load(); checkPermission(); }, 30_000);
    const focus = () => { void load(); checkPermission(); };
    window.addEventListener("focus", focus);
    return () => { clearTimeout(initial); clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [load, checkPermission]);
  const save = async (patch: Partial<ScheduleNotificationPreferences>) => {
    if (!value || !accountId || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setFeedback("");
    generation.current++;
    try {
      const merged = { ...value, ...patch };
      const { destination, enabled, leadMinutes, atStart, timeZone, revision } = merged;
      const result = await notificationRequest<ScheduleNotificationPreferences>("/preferences", accountId, { destination, enabled, leadMinutes, atStart, timeZone, revision }, "PUT");
      if (getSession()?.account.id !== accountId) return;
      setValue(result); setFeedback("Schedule notification settings saved for this account.");
      window.dispatchEvent(new Event(NOTIFICATION_SETTINGS_EVENT));
    } catch (e) {
      if (getSession()?.account.id !== accountId) return;
      setError(e instanceof Error ? e.message : "Could not save settings.");
      if ((e as { status?: number }).status === 409) {
        const fresh = await notificationRequest<ScheduleNotificationPreferences>("/preferences", accountId).catch(() => null);
        if (fresh && getSession()?.account.id === accountId) setValue(fresh);
      }
    } finally { saving.current = false; setBusy(false); }
  };
  const platform = notificationPlatform();
  const requestPermission = async () => {
    setPermissionAction("request"); setError(""); setFeedback("");
    try {
      const result = await notificationPermission(true);
      setPermission(result);
      setFeedback(result === "granted" ? "Notifications are enabled on this device." : platform === "mobile" ? "Allow notifications in the Android permission prompt. If Android no longer shows a prompt, open Android settings." : "Check your operating system’s notification settings to allow alerts.");
      window.dispatchEvent(new Event(NOTIFICATION_SETTINGS_EVENT));
    } catch { setError("Could not request notification permission. Check OS notification settings."); }
    finally { setPermissionAction(null); }
  };
  const openSettings = async () => {
    setPermissionAction("settings"); setError(""); setFeedback("");
    try {
      await openNotificationSettings();
      setFeedback(platform === "desktop" ? "Windows notification settings opened. Check that notifications are on, Alfred is allowed, and Do Not Disturb is off." : "Android notification settings opened. Check that Alfred’s schedule notifications are allowed.");
    } catch { setError("Could not open notification settings. Open your operating system’s notification settings manually."); }
    finally { setPermissionAction(null); }
  };
  return <section className="settings-card-group schedule-notification-settings">
    <h3 className="settings-group-header"><Bell size={16} className="settings-group-icon" />Schedule Notifications</h3>
    <div className="settings-feature-card">
      {!value ? error ? null : <Loader label="Loading notification settings…" /> : <fieldset disabled={busy} className="schedule-notification-fields">
        <legend className="sr-only">Schedule notification preferences</legend>
        <div className="settings-feature-row"><label htmlFor="schedule-notifications-enabled" className="settings-feature-title">Schedule reminders</label><input id="schedule-notifications-enabled" type="checkbox" checked={value.enabled} onChange={e => void save({ enabled: e.target.checked })} /></div>
        <fieldset className="schedule-destination"><legend>Delivery destination</legend>
          {([['mobile', 'Mobile only'], ['desktop', 'Desktop only'], ['both', 'Both']] as const).map(([destination, label]) => <label key={destination}><input type="radio" name="schedule-notification-destination" checked={value.destination === destination} onChange={() => void save({ destination })} />{label}</label>)}
        </fieldset>
        <div className="settings-feature-row"><label htmlFor="schedule-lead-minutes" className="settings-feature-title">Remind me before</label><select id="schedule-lead-minutes" className="settings-select-input" value={value.leadMinutes} onChange={e => void save({ leadMinutes: Number(e.target.value) })}>{[...new Set([0, 5, 10, 15, 30, 60, 1440, value.leadMinutes])].sort((a,b) => a-b).map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? "At start" : minutes === 1440 ? "1 day" : `${minutes} minutes`}</option>)}</select></div>
        <div className="settings-feature-row"><label htmlFor="schedule-at-start" className="settings-feature-title">Also notify at event start</label><input id="schedule-at-start" type="checkbox" checked={value.atStart} onChange={e => void save({ atStart: e.target.checked })} /></div>
        <div className="settings-feature-row"><label htmlFor="schedule-notification-zone" className="settings-feature-title">Schedule time zone</label><select id="schedule-notification-zone" className="settings-select-input" value={value.timeZone} onChange={e => void save({ timeZone: e.target.value })}>{[...new Set([value.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC", ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></div>
      </fieldset>}
      <div className="settings-feature-row"><div className="settings-feature-info"><span className="settings-feature-title">Permission on this device: {permission}</span><span className="settings-feature-desc">{!platform ? "Native notifications require the installed Android or desktop app." : platform === "desktop" ? "Desktop delivery works while Alfred is running, including in the system tray. OS settings may silence alerts." : "Android uses native alarms and background sync. Battery restrictions may delay delivery. Internet access is needed when a reminder is due."}</span><span className="settings-feature-desc">{value && value.destination !== "both" && value.destination !== platform ? "This device is excluded by your delivery destination." : permission !== "granted" ? "Your selected destination needs notification permission on each receiving device." : "Permission on other devices is managed in their own operating-system settings."} Preferences synchronize across devices using the same account.</span></div></div>
      {platform && <div className="schedule-permission-actions">
        <button type="button" className="settings-action-btn" aria-busy={permissionAction === "request" || permission === "checking"} disabled={permission === "granted" || permission === "checking" || permission === "unavailable" || permissionAction !== null} onClick={() => void requestPermission()}>
          {permissionAction === "request" || permission === "checking" ? "Checking permission…" : permission === "granted" ? "Notifications enabled" : permission === "unavailable" ? "Notifications unavailable" : "Enable notifications"}
        </button>
        {canOpenNotificationSettings() && <button type="button" className="settings-action-btn" aria-busy={permissionAction === "settings"} disabled={permissionAction !== null} onClick={() => void openSettings()}>{permissionAction === "settings" ? "Opening settings…" : platform === "desktop" ? "Open Windows notification settings" : "Open Android settings"}</button>}
      </div>}
      {platform === "mobile" && !exactAlarms && <div className="settings-feature-row"><div className="settings-feature-info"><span className="settings-feature-desc">Android currently permits inexact alarms, which can arrive too late. Allow “Alarms &amp; reminders” for more precise timing. Background network and battery limits still apply.</span><button type="button" className="settings-action-btn" onClick={() => { void androidNotificationRequest("timing").catch(() => setError("Could not open Alarms & reminders settings.")); }}>Improve reminder timing</button></div></div>}
      {platform && <p className="settings-save-feedback" role="status">{deliveryStatus}</p>}
      <p className="settings-save-feedback" role="status">{busy ? "Saving…" : feedback}</p><ErrorNotice message={error} retry={() => void load()} />
    </div>
  </section>;
}
