import { memo, useState } from "react";
import { useAuth } from "../../auth/authContext.ts";
import { User, LogIn, LogOut, Mic, Shield, Smartphone } from "lucide-react";

function SettingsViewComponent() {
  const { session, loginWithGoogle, logout } = useAuth();
  const isGoogleUser = session?.account?.type === "user";
  const displayName =
    session?.account?.name ||
    session?.account?.email?.split("@")[0] ||
    "Guest";

  const [silenceTimeout, setSilenceTimeout] = useState<number>(() => {
    try {
      const stored = localStorage.getItem("alfred_silence_threshold_ms");
      return stored ? Number(stored) : 1500;
    } catch {
      return 1500;
    }
  });

  return (
    <div className="settings-view-container">
      <div className="settings-view-scrollable">
        {/* Account Section */}
        <section className="settings-card-group">
          <h3 className="settings-group-header">
            <User size={16} className="settings-group-icon" />
            Account
          </h3>
          <div className="settings-profile-card">
            <div className="settings-profile-top">
              {isGoogleUser && session.account.picture ? (
                <img
                  src={session.account.picture}
                  alt={displayName}
                  className="settings-profile-avatar-img"
                />
              ) : (
                <div className="settings-profile-avatar-circle">
                  {isGoogleUser ? displayName[0]?.toUpperCase() : "G"}
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
                  onClick={() => loginWithGoogle()}
                >
                  <LogIn size={16} />
                  <span>Sign in with Google</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Assistant & Audio Section */}
        <section className="settings-card-group">
          <h3 className="settings-group-header">
            <Mic size={16} className="settings-group-icon" />
            Assistant & Voice
          </h3>
          <div className="settings-feature-card">
            <div className="settings-feature-row">
              <div className="settings-feature-info">
                <span className="settings-feature-title">Speech-to-Text</span>
                <span className="settings-feature-desc">
                  Whisper on-device & server-assisted voice transcription
                </span>
              </div>
              <span className="settings-status-badge is-active">Active</span>
            </div>
            <div className="settings-feature-row">
              <div className="settings-feature-info">
                <span className="settings-feature-title">Push-to-Talk</span>
                <span className="settings-feature-desc">
                  Hold microphone button on Assistant screen to speak
                </span>
              </div>
              <span className="settings-status-badge">Ready</span>
            </div>
            <div className="settings-feature-row">
              <div className="settings-feature-info">
                <span className="settings-feature-title">Voice Mode Silence Timeout</span>
                <span className="settings-feature-desc">
                  Pause duration before voice messages are sent
                </span>
              </div>
              <select
                value={silenceTimeout}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSilenceTimeout(val);
                  localStorage.setItem("alfred_silence_threshold_ms", String(val));
                }}
                className="settings-select-input"
                aria-label="Voice Mode Silence Timeout"
              >
                <option value={1000}>1.0s (Fast)</option>
                <option value={1500}>1.5s (Default)</option>
                <option value={2000}>2.0s (Relaxed)</option>
                <option value={2500}>2.5s (Long pause)</option>
              </select>
            </div>
          </div>
        </section>

        {/* System & Privacy Section */}
        <section className="settings-card-group">
          <h3 className="settings-group-header">
            <Shield size={16} className="settings-group-icon" />
            Privacy & Security
          </h3>
          <div className="settings-feature-card">
            <div className="settings-feature-row">
              <div className="settings-feature-info">
                <span className="settings-feature-title">Local Data Vault</span>
                <span className="settings-feature-desc">
                  Encrypted local session cache and SQLite sync
                </span>
              </div>
              <span className="settings-status-badge is-active">Protected</span>
            </div>
          </div>
        </section>

        {/* App Info Section */}
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
              <span className="settings-info-val">Android (Tauri 2)</span>
            </div>
            <div className="settings-info-row">
              <span className="settings-info-label">Version</span>
              <span className="settings-info-val">v1.0.0-mobile</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export const SettingsView = memo(SettingsViewComponent);
export default SettingsView;
