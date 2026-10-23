import { useEffect, useRef, useState } from "react";
import { User } from "lucide-react";
import { useAuth } from "../../auth/authContext.ts";
import { useAccountProfile } from "../../hooks/useAccountProfile.ts";
import { saveAccountProfile } from "../../lib/accountProfile.ts";

export function ProfileEditor() {
  const { session } = useAuth();
  return session ? <ProfileEditorForm key={session.account.id} /> : null;
}
function ProfileEditorForm() {
  const { session } = useAuth();
  const profile = useAccountProfile(session);
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? profile.name;
  const picture = profile.picture;
  const dirty = draft !== null;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  if (!session) return null;
  return <section className="settings-card-group profile-editor">
    <details className="settings-details"><summary className="settings-group-header"><User size={16} className="settings-group-icon" />Edit profile</summary>
    <form className="settings-feature-card" onSubmit={event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(""); setFeedback("");
      const current = generation.current;
      void saveAccountProfile(session.account.id, name).then(() => { if (current === generation.current) { setDraft(null); setFeedback("Profile saved."); } }).catch((e: unknown) => { if (current === generation.current) setError(e instanceof Error ? e.message : "Could not save profile."); }).finally(() => { if (current === generation.current) setBusy(false); });
    }}>
      <label htmlFor="profile-name" className="settings-feature-title">Account name</label>
      <input id="profile-name" className="settings-select-input" autoComplete="nickname" maxLength={100} required value={name} disabled={busy} onChange={event => { setDraft(event.target.value); setFeedback(""); }} />
      <div className="profile-photo-preview">
        {picture ? <img src={picture} alt="Google account photo" className="settings-profile-avatar-img" /> : <div className="settings-profile-avatar-circle">{name.trim()[0]?.toUpperCase() || "G"}</div>}
      </div>
      <p className="settings-feature-desc">Profile photos come from your Google account; guests use initials. Name changes stay on this device unless Cloud Sync is enabled.</p>
      <button type="submit" className="settings-action-btn" disabled={busy || !dirty || !name.trim()}>{busy ? "Saving…" : "Save profile"}</button>
      <p className="settings-save-feedback" role={error ? "alert" : "status"}>{error || feedback}</p>
    </form>
    </details>
  </section>;
}
