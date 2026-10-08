import { useState } from "react";
import Mic from "../assets/Mic_Icon.png";
import { useAuth } from "../auth/authContext.ts";

export default function Chat() {
    const { session, loginWithGoogle, logout } = useAuth();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const isGoogleUser = session?.account?.type === "user";
    const displayName = session?.account?.name || session?.account?.email?.split("@")[0] || "Guest";

    return (
        <section className="Chat">
            <div className="chat-main-content">
                <img src={Mic} alt="Microphone" />
                <p>Ask anything / Schedule a meeting!</p>
                <input aria-label="Ask" placeholder="Ask Alfred anything.." />
            </div>

            {/* Bottom-left user profile & settings bar */}
            <div className="chat-bottom-bar">
                <div className="user-bar-profile">
                    {isGoogleUser && session.account.picture ? (
                        <img
                            src={session.account.picture}
                            alt={displayName}
                            className="user-bar-avatar-img"
                        />
                    ) : (
                        <div className="user-bar-avatar-circle">
                            {isGoogleUser ? displayName[0].toUpperCase() : ""}
                        </div>
                    )}

                    <div className="user-bar-label">
                        {isGoogleUser ? (
                            <span className="user-bar-name" title={displayName}>
                                {displayName}
                            </span>
                        ) : (
                            <button
                                type="button"
                                className="user-bar-signin-btn"
                                onClick={loginWithGoogle}
                            >
                                Sign in with google
                            </button>
                        )}
                    </div>
                </div>

                <button
                    type="button"
                    className="user-bar-settings-btn"
                    aria-label="Settings"
                    title="Settings"
                    onClick={() => setIsSettingsOpen(true)}
                >
                    <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                </button>
            </div>

            {/* Settings Modal */}
            {isSettingsOpen && (
                <div
                    className="task-dialog-backdrop"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setIsSettingsOpen(false);
                    }}
                >
                    <section
                        className="settings-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-title"
                    >
                        <div className="task-dialog-heading">
                            <h2 id="settings-title">Settings</h2>
                            <button
                                type="button"
                                className="task-dialog-close"
                                onClick={() => setIsSettingsOpen(false)}
                                aria-label="Close settings"
                            >
                                ×
                            </button>
                        </div>

                        <div className="settings-content">
                            {/* Account Section */}
                            <div className="settings-section">
                                <h3 className="settings-section-title">Account</h3>
                                <div className="settings-account-card">
                                    <div className="settings-account-info">
                                        {isGoogleUser && session.account.picture ? (
                                            <img
                                                src={session.account.picture}
                                                alt=""
                                                className="settings-avatar-img"
                                            />
                                        ) : (
                                            <div className="settings-avatar-circle">
                                                {isGoogleUser ? displayName[0].toUpperCase() : "G"}
                                            </div>
                                        )}
                                        <div className="settings-account-meta">
                                            <span className="settings-account-name">{displayName}</span>
                                            <span className="settings-account-email">
                                                {session?.account?.email || (isGoogleUser ? "" : "Guest Account")}
                                            </span>
                                        </div>
                                    </div>

                                    {isGoogleUser ? (
                                        <button
                                            type="button"
                                            className="settings-logout-btn"
                                            onClick={() => {
                                                logout();
                                                setIsSettingsOpen(false);
                                            }}
                                        >
                                            Log out
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            className="settings-signin-btn"
                                            onClick={() => {
                                                loginWithGoogle();
                                                setIsSettingsOpen(false);
                                            }}
                                        >
                                            Sign in with Google
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Preferences Section Placeholder */}
                            <div className="settings-section">
                                <h3 className="settings-section-title">Preferences</h3>
                                <div className="settings-placeholder-box">
                                    <p className="settings-coming-soon-text">
                                        Custom voice parameters, models, and personal preferences will be configured here soon.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </section>
    );
}
