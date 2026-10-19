import { PREFERENCES_CHANGED_EVENT } from "../../lib/accountPreferences.ts";
import { ProfileEditor } from "./ProfileEditor.tsx";
import { useAccountProfile } from "../../hooks/useAccountProfile.ts";
import { ErrorNotice } from "../reliability/Notifications";
import { memo, useEffect, useState } from "react";
import { AccountPanel } from "../reliability/AccountPanel";
import { useAuth } from "../../auth/authContext.ts";
import { User, LogIn, LogOut, Mic, Smartphone } from "lucide-react";
import { isTauri } from "../../auth/auth.ts";
import { getSilenceTimeout, saveSilenceTimeout } from "../../lib/voicePreferences.ts";
import { AndroidAssistantSetup } from "../../android/AndroidAssistantSetup.tsx";
import { ScheduleNotificationSettings } from "./ScheduleNotificationSettings.tsx";
import { AppUpdateSettings } from "./AppUpdateSettings.tsx";
import { AndroidAppUpdateSettings } from "../../android/AndroidAppUpdateSettings.tsx";
import { StartupSettings } from "./StartupSettings.tsx";
import {
  type DesktopOverlayMode,
  getSavedOverlayMode,
  setSavedOverlayMode,
} from "../../lib/overlayMode.ts";

function SettingsViewComponent() {
  const { session, loginWithGoogle, logout, loading, error } = useAuth();
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isNative = isTauri();
  const [appVersion, setAppVersion] = useState(isNative ? "Loading…" : "Web preview");
  const [feedback, setFeedback] = useState("");
  const [saveError, setSaveError] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (isNative) {
      void import("@tauri-apps/api/app").then((app) => app.getVersion())
        .then((version) => { if (active) setAppVersion(version); })
        .catch(() => { if (active) setAppVersion("Unavailable"); });
    }
    return () => { active = false; };
  }, [isNative]);
  const isGoogleUser = session?.account?.type === "user";
  const profile = useAccountProfile(session);
  const displayName = profile.name;

  const [silenceTimeout, setSilenceTimeout] = useState(getSilenceTimeout);

  const [overlayMode, setOverlayMode] = useState<DesktopOverlayMode>(() =>
    getSavedOverlayMode()
  );

  useEffect(() => {
    const changed = () => { setSilenceTimeout(getSilenceTimeout()); setOverlayMode(getSavedOverlayMode()); };
    changed(); window.addEventListener(PREFERENCES_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, changed);
  }, [session?.account.id]);

  return (
    <div className="settings-view-container">
      <div className="settings-view-scrollable">
        <div className="settings-intro">
          <p>Account, assistant & devices.</p>
          <span>Settings belong to your account.</span>
          <p className="settings-save-feedback" role="status">{feedback}</p>
          <ErrorNotice message={saveError || error} />
        </div>
        {/* Account Section */}
        <section className="settings-card-group">
          <h3 className="settings-group-header">
            <User size={16} className="settings-group-icon" />
            Account
          </h3>
          <div className="settings-profile-card">
            <div className="settings-profile-top">
              {profile.picture ? (
                <img
                  src={profile.picture ?? undefined}
                  alt={displayName}
                  className="settings-profile-avatar-img"
                />
              ) : (
                <div className="settings-profile-avatar-circle">
                  {displayName[0]?.toUpperCase() || "G"}
                </div>
              )}
              <div className="settings-profile-meta">
                <span className="settings-profile-name">{displayName}</span>
                <span className="settings-profile-email">
                  {session?.account?.email || (isGoogleUser ? "" : "Guest Mode")}
                </span>
              </div>
            </div>

            <div className="settings-profile-actions">
              {isGoogleUser ? (
                <button
                  type="button"
                  className="settings-action-btn is-logout"
                  onClick={() => logout()}
                >
                  <LogOut size={16} />
                  <span>Log out</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="settings-action-btn is-login"
                  disabled={loading || accountBusy}
                  onClick={async () => {
                    setAccountBusy(true);
                    setSaveError("");
                    try { await loginWithGoogle(); }
                    catch (error) { setSaveError(error instanceof Error ? error.message : "Sign-in could not start. Please try again."); }
                    finally { setAccountBusy(false); }
                  }}
                >
                  <LogIn size={16} />
                  <span>{accountBusy ? "Opening sign-in…" : "Sign in with Google"}</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Assistant & Audio Section */}
        <ProfileEditor />
        {isAndroid && <AndroidAssistantSetup />}
        <section className="settings-card-group">
          <h3 className="settings-group-header">
            <Mic size={16} className="settings-group-icon" />
            Assistant & Voice
          </h3>
          <div className="settings-feature-card">
            <div className="settings-feature-row">
              <div className="settings-feature-info">
                <span className="settings-feature-title">Voice input</span>
                <span className="settings-feature-desc">
                  Select the microphone in the chat box to start or stop dictation.
                </span>
              </div>
            </div>
            <div className="settings-feature-row">
              <div className="settings-feature-info">
                <span className="settings-feature-title">Hands-free conversation</span>
                <span className="settings-feature-desc">
                  Select the red voice button to talk with Alfred. Microphone permission is required.
                </span>
              </div>
            </div>
            <div className="settings-feature-row">
              <div className="settings-feature-info">
                <label htmlFor="voice-silence-timeout" className="settings-feature-title">Pause before sending</label>
                <span className="settings-feature-desc">
                  How long Alfred waits after you stop speaking in hands-free mode. Applies to the next recording turn.
                </span>
              </div>
              <select
                id="voice-silence-timeout"
                value={silenceTimeout}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFeedback("");
                  setSaveError("");
                  try {
                    saveSilenceTimeout(val);
                    setSilenceTimeout(val);
                    setFeedback("Voice pause saved for this account.");
                  } catch { setSaveError("Could not save your voice preference. Check whether device storage is available."); }
                }}
                className="settings-select-input"
              >
                <option value={1000}>1.0s (Fast)</option>
                <option value={1500}>1.5s (Default)</option>
                <option value={2000}>2.0s (Relaxed)</option>
                <option value={2500}>2.5s (Long pause)</option>
              </select>
            </div>
            {(isNative || isAndroid) && <div className="settings-feature-row">
              <div className="settings-feature-info">
                <label htmlFor="desktop-overlay-mode" className="settings-feature-title">Quick overlay opens in</label>
                <span className="settings-feature-desc">
                  Choose text or voice when opening the floating assistant on PC or Android.
                </span>
              </div>
              <select
                id="desktop-overlay-mode"
                value={overlayMode}
                onChange={(e) => {
                  const val = e.target.value as "quick_input" | "voice";
                  setFeedback("");
                  setSaveError("");
                  if (setSavedOverlayMode(val)) {
                    setOverlayMode(val);
                    setFeedback("Overlay preference saved. Applies the next time you open it.");
                  } else { setSaveError("Could not save your overlay preference. Please try again."); }
                }}
                className="settings-select-input"
              >
                <option value="quick_input">Quick Input (Default)</option>
                <option value="voice">Voice Listening</option>
              </select>
            </div>}
          </div>
        </section>

        {/* System & Privacy Section */}
        <ScheduleNotificationSettings />
        <StartupSettings />
        {/* App Info Section */}
        <AccountPanel key={session?.account.id} />
        {isAndroid ? <AndroidAppUpdateSettings /> : <AppUpdateSettings />}
        <section className="settings-card-group">
          <h3 className="settings-group-header">
            <Smartphone size={16} className="settings-group-icon" />
            App Information
          </h3>
          <div className="settings-info-card">
            <div className="settings-info-row">
              <span className="settings-info-label">Application</span>
              <span className="settings-info-val">Alfred Desktop & Mobile</span>
            </div>
            <div className="settings-info-row">
              <span className="settings-info-label">Platform</span>
              <span className="settings-info-val">{isNative ? (isAndroid ? "Android app" : "Desktop app") : "Web browser"}</span>
            </div>
            <div className="settings-info-row">
              <span className="settings-info-label">Version</span>
              <span className="settings-info-val">{appVersion}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export const SettingsView = memo(SettingsViewComponent);
export default SettingsView;
