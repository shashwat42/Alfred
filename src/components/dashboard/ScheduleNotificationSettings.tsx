import { Loader } from "../reliability/States";
import { ErrorNotice } from "../reliability/Notifications";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "../../auth/authContext.ts";
import { clearRevokedSession, getSession } from "../../auth/auth.ts";
import { desktopPlatform } from "../../lib/desktopPlatform.ts";
import { androidNotificationRequest, automaticTimeZone, detectedTimeZone, syncDetectedTimeZone, canOpenNotificationSettings, openNotificationSettings, getNotificationDeliveryStatus, subscribeNotificationDeliveryStatus, installationSecret, isAndroid, notificationPermission, notificationPlatform, notificationRequest, NOTIFICATION_DEVICES_EVENT, NOTIFICATION_SETTINGS_EVENT, type ScheduleNotificationDevice, type ScheduleNotificationPreferences } from "../../lib/scheduleNotifications.ts";
import { cloudSyncEnabled, STORAGE_MODE_EVENT } from "../../lib/localWorkspace.ts";

export function ScheduleNotificationSettings() {
  const { session } = useAuth();
  const enabled = useSyncExternalStore(listener => {
    window.addEventListener(STORAGE_MODE_EVENT, listener); window.addEventListener("storage", listener);
    return () => { window.removeEventListener(STORAGE_MODE_EVENT, listener); window.removeEventListener("storage", listener); };
  }, () => cloudSyncEnabled(session?.account.id));
  if (!enabled) return <section className="settings-card-group schedule-notification-settings"><h3 className="settings-group-header"><Bell size={16} />Schedule notifications</h3><p className="settings-feature-desc">Your schedules stay on this device. Enable Cloud Sync to use cloud reminder delivery, including Android background alarms and push notifications.</p></section>;
  return <ScheduleNotificationSettingsForm key={session?.account.id ?? "signed-out"} accountId={session?.account.id} />;
}

function ScheduleNotificationSettingsForm({ accountId }: { accountId: string | undefined }) {
  const [value, setValue] = useState<ScheduleNotificationPreferences | null>(null);
  const [devices, setDevices] = useState<ScheduleNotificationDevice[] | null>(null);
  const [devicesUnavailable, setDevicesUnavailable] = useState(false);
  const [deviceAction, setDeviceAction] = useState<{ id: string; name?: string } | null>(null);
  const [permission, setPermission] = useState("checking");
  const [exactAlarms, setExactAlarms] = useState(false);
  const [pushRegistered, setPushRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [permissionAction, setPermissionAction] = useState<"request" | "settings" | null>(null);
  const deliveryStatus = useSyncExternalStore(subscribeNotificationDeliveryStatus, getNotificationDeliveryStatus);
  const saving = useRef(false);
  const generation = useRef(0);
  const loadDevices = useCallback(async () => {
    if (!accountId) return null;
    const secret = notificationPlatform() ? installationSecret() : undefined;
    return notificationRequest<ScheduleNotificationDevice[]>("/devices/list", accountId, { secret });
  }, [accountId]);
  const load = useCallback(async () => {
    if (!accountId || saving.current) return;
    const requestGeneration = ++generation.current;
    const [saved, registered] = await Promise.allSettled([syncDetectedTimeZone(accountId), loadDevices()]);
    if (getSession()?.account.id !== accountId || saving.current || requestGeneration !== generation.current) return;
    if (saved.status === "fulfilled") { setValue(saved.value); setError(""); }
    else setError("Could not load schedule notification settings. Please retry.");
    setDevices(registered.status === "fulfilled" ? registered.value : null);
    setDevicesUnavailable(registered.status === "rejected");
  }, [accountId, loadDevices]);
  const alertType = value?.alertType ?? "notification";
  const checkPermission = useCallback(() => {
    if (!isAndroid()) {
      void notificationPermission().then(setPermission).catch(() => setPermission("unavailable"));
      return;
    }
    void androidNotificationRequest("status", { alertType }).then(status => {
      setPermission(status.granted ? "granted" : "denied");
      setExactAlarms(Boolean(status.exactAlarms));
      setPushRegistered(Boolean(status.pushRegistered));
    }).catch(() => {
      setPermission("unavailable");
      setExactAlarms(false);
      setPushRegistered(false);
    });
  }, [alertType]);
  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); checkPermission(); }, 0);
    const timer = setInterval(() => { void load(); checkPermission(); }, 30_000);
    const focus = () => { void load(); checkPermission(); };
    const registrationChanged = () => { void load(); };
    window.addEventListener("focus", focus);
    window.addEventListener(NOTIFICATION_DEVICES_EVENT, registrationChanged);
    return () => {
      clearTimeout(initial); clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener(NOTIFICATION_DEVICES_EVENT, registrationChanged);
    };
  }, [load, checkPermission]);
  const save = async (patch: Partial<ScheduleNotificationPreferences>) => {
    if (!value || !accountId || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setFeedback("");
    generation.current++;
    try {
      const merged = { ...value, ...patch };
      const { destination, enabled, leadMinutes, atStart, timeZone, timeZoneMode, revision } = merged;
      const result = await notificationRequest<ScheduleNotificationPreferences>("/preferences", accountId, { destination, deviceId: patch.deviceId, alertType: patch.alertType, enabled, leadMinutes, atStart, timeZone, timeZoneMode, revision }, "PUT");
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
      if ((e as { status?: number }).status === 422) {
        const refreshed = await loadDevices().catch(() => null);
        if (getSession()?.account.id === accountId) {
          setDevices(refreshed); setDevicesUnavailable(refreshed === null);
        }
      }
    } finally { saving.current = false; setBusy(false); }
  };
  const platform = notificationPlatform();
  const canManageDevices = platform === "desktop" && desktopPlatform(navigator.userAgent) !== null;
  const updateDevice = async (device: ScheduleNotificationDevice, name?: string) => {
    const session = getSession();
    if (!accountId || session?.account.id !== accountId || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setFeedback("");
    generation.current++;
    try {
      await notificationRequest(`/devices/${device.id}`, accountId, name === undefined ? undefined : { name }, name === undefined ? "DELETE" : "PATCH");
      if (getSession()?.token !== session.token) return;
      if (name === undefined && device.isCurrent) { clearRevokedSession(session.token); return; }
      setDevices(rows => name === undefined
        ? rows?.filter(row => row.id !== device.id) ?? null
        : rows?.map(row => row.id === device.id ? { ...row, name } : row) ?? null);
      setDeviceAction(null);
      setFeedback(name === undefined ? `${device.name} was signed out and removed.` : "Device name saved.");
    } catch (err) {
      if (getSession()?.token === session.token) setError(err instanceof Error ? err.message : "Could not update the device.");
    } finally { saving.current = false; setBusy(false); }
  };
  const currentDevice = devices?.find(device => device.isCurrent);
  const excluded = value && (value.deviceId
    ? currentDevice && currentDevice.id !== value.deviceId
    : platform && value.destination !== "both" && value.destination !== platform);
  const requestPermission = async () => {
    setPermissionAction("request"); setError(""); setFeedback("");
    try {
      const result = await notificationPermission(true, alertType);
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
        <div className="settings-feature-row"><label htmlFor="schedule-notifications-enabled" className="settings-feature-title">Schedule reminders</label><input id="schedule-notifications-enabled" type="checkbox" role="switch" checked={value.enabled} onChange={e => void save({ enabled: e.target.checked })} /></div>
        <div className="settings-feature-row">
          <div className="settings-feature-info">
            <label htmlFor="schedule-alert-type" className="settings-feature-title">Alert type</label>
            <span id="schedule-alert-type-help" className="settings-feature-desc">Alarms repeat a sound and can be dismissed on the device receiving the reminder.</span>
          </div>
          <select id="schedule-alert-type" className="settings-select-input" aria-describedby="schedule-alert-type-help" value={alertType} onChange={e => void save({ alertType: e.target.value === "alarm" ? "alarm" : "notification" })}>
            <option value="notification">Notification</option>
            <option value="alarm">Alarm</option>
          </select>
        </div>
        <fieldset className="schedule-destination"><legend>Reminder device</legend>
          {devicesUnavailable && <div className="settings-feature-info"><span className="settings-feature-desc">Could not load your devices.</span><button type="button" className="settings-action-btn" onClick={() => void load()}>Retry</button></div>}
          {!devicesUnavailable && devices === null && <p className="settings-feature-desc" role="status">Loading devices…</p>}
          {devices?.length === 0 && <p className="settings-feature-desc">Open the Alfred app on a device signed in to this account to add it here.</p>}
          {devices && value.deviceId && !devices.some(device => device.id === value.deviceId) && <p className="settings-feature-desc">Your selected device is no longer available. Choose another device to resume reminders.</p>}
          {devices && devices.length > 0 && !value.deviceId && <p className="settings-feature-desc">Choose a device to send reminders there. Your current delivery settings apply until you choose.</p>}
          {devices?.map(device => {
            const action = deviceAction?.id === device.id ? deviceAction : null;
            return <div className="schedule-device" key={device.id}>
              <div className="schedule-device-row">
                <label>
                  <input type="radio" name="schedule-notification-device" checked={value.deviceId === device.id} onChange={() => void save({ deviceId: device.id })} />
                  <span>{device.name}{devices.some(other => other.id !== device.id && other.name === device.name) ? ` (${device.id.slice(0, 6)})` : ""}{device.isCurrent ? " · This device" : ""}</span>
                </label>
                {canManageDevices && <>
                  <button type="button" className="settings-action-btn" title="Rename device" aria-label={`Rename ${device.name}`} onClick={() => setDeviceAction({ id: device.id, name: device.name })}><Pencil size={16} /></button>
                  <button type="button" className="settings-action-btn" title="Sign out and remove device" aria-label={`Sign out and remove ${device.name}`} onClick={() => setDeviceAction({ id: device.id })}><Trash2 size={16} /></button>
                </>}
              </div>
              {action && (action.name !== undefined ? <form className="schedule-device-action" onSubmit={event => { event.preventDefault(); const name = action.name?.trim(); if (name) void updateDevice(device, name); }}>
                <input className="settings-select-input" aria-label="Device name" value={action.name} required maxLength={80} onChange={event => setDeviceAction({ id: device.id, name: event.target.value })} />
                <button className="settings-action-btn" type="submit" disabled={!action.name.trim()}>Save name</button>
                <button className="settings-action-btn" type="button" onClick={() => setDeviceAction(null)}>Cancel</button>
              </form> : <div className="schedule-device-action">
                <p className="settings-feature-desc">Sign out {device.name} and remove it from this list?</p>
                <button className="settings-action-btn" type="button" onClick={() => void updateDevice(device)}>Sign out and remove</button>
                <button className="settings-action-btn" type="button" onClick={() => setDeviceAction(null)}>Cancel</button>
              </div>)}
            </div>;
          })}
        </fieldset>
        <div className="settings-feature-row"><label htmlFor="schedule-lead-minutes" className="settings-feature-title">Remind me before</label><select id="schedule-lead-minutes" className="settings-select-input" value={value.leadMinutes} onChange={e => void save({ leadMinutes: Number(e.target.value) })}>{[...new Set([0, 5, 10, 15, 30, 60, 1440, value.leadMinutes])].sort((a,b) => a-b).map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? "At start" : minutes === 1440 ? "1 day" : `${minutes} minutes`}</option>)}</select></div>
        <div className="settings-feature-row"><label htmlFor="schedule-at-start" className="settings-feature-title">Also notify at event start</label><input id="schedule-at-start" type="checkbox" role="switch" checked={value.atStart} onChange={e => void save({ atStart: e.target.checked })} /></div>
        <div className="settings-feature-row"><label htmlFor="schedule-notification-zone" className="settings-feature-title">Schedule time zone</label><select id="schedule-notification-zone" className="settings-select-input" value={automaticTimeZone(value) ? "automatic" : value.timeZone} onChange={e => void save(e.target.value === "automatic" ? { timeZoneMode: "automatic", timeZone: detectedTimeZone() ?? value.timeZone } : { timeZoneMode: "manual", timeZone: e.target.value })}><option value="automatic">Automatic — {detectedTimeZone() ?? value.timeZone}</option>{[...new Set([value.timeZone, detectedTimeZone() ?? value.timeZone, "UTC", ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></div>
        <p className="settings-feature-desc">Automatic detects your device’s time zone and updates the account’s reminder timing when Alfred is open. Choose a specific zone to keep it fixed across devices.</p>
      </fieldset>}
      <div className="settings-feature-row"><div className="settings-feature-info"><span className="settings-feature-title">Permission on this device: {permission}</span><span className="settings-feature-desc">{!platform ? "Native notifications require the installed Android or desktop app." : platform === "desktop" ? "Desktop delivery works while Alfred is running in the background. OS settings may silence alerts." : "Android uses push notifications and native alarms. Internet access is needed. Android force-stop and device battery restrictions can prevent delivery."}</span><span className="settings-feature-desc">{excluded ? "Reminders are routed to another device." : "Allow notifications in the operating-system settings on the device you choose."} Preferences synchronize across devices using the same account.</span></div></div>
      {platform && <div className="schedule-permission-actions">
        <button type="button" className="settings-action-btn" aria-busy={permissionAction === "request" || permission === "checking"} disabled={permission === "granted" || permission === "checking" || permission === "unavailable" || permissionAction !== null} onClick={() => void requestPermission()}>
          {permissionAction === "request" || permission === "checking" ? "Checking permission…" : permission === "granted" ? "Notifications enabled" : permission === "unavailable" ? "Notifications unavailable" : "Enable notifications"}
        </button>
        {canOpenNotificationSettings() && <button type="button" className="settings-action-btn" aria-busy={permissionAction === "settings"} disabled={permissionAction !== null} onClick={() => void openSettings()}>{permissionAction === "settings" ? "Opening settings…" : platform === "desktop" ? "Open Windows notification settings" : "Open Android settings"}</button>}
      </div>}
      {platform === "mobile" && <p className="settings-feature-desc">{pushRegistered ? "Push notifications registered for this phone." : "Push registration pending. Keep Alfred open with internet access to finish setup."}</p>}
      {platform === "mobile" && !exactAlarms && <div className="settings-feature-row"><div className="settings-feature-info"><span className="settings-feature-desc">Android currently permits inexact alarms, which can arrive too late. Allow “Alarms &amp; reminders” for more precise timing. Background network and battery limits still apply.</span><button type="button" className="settings-action-btn" onClick={() => { void androidNotificationRequest("timing").catch(() => setError("Could not open Alarms & reminders settings.")); }}>Improve reminder timing</button></div></div>}
      {platform && <p className="settings-save-feedback" role="status">{deliveryStatus}</p>}
      <p className="settings-save-feedback" role="status">{busy ? "Saving…" : feedback}</p><ErrorNotice message={error} retry={() => void load()} />
    </div>
  </section>;
}
