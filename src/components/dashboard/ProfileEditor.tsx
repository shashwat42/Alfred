import { useEffect, useRef, useState } from "react";
import { Camera, User } from "lucide-react";
import { useAuth } from "../../auth/authContext.ts";
import { useAccountProfile } from "../../hooks/useAccountProfile.ts";
import { prepareProfilePicture, saveAccountProfile } from "../../lib/accountProfile.ts";

export function ProfileEditor() {
  const { session } = useAuth();
  return session ? <ProfileEditorForm key={session.account.id} /> : null;
}
function ProfileEditorForm() {
  const { session } = useAuth();
  const profile = useAccountProfile(session);
  const [draft, setDraft] = useState<{ name: string; picture: string | null } | null>(null);
  const name = draft?.name ?? profile.name, picture = draft ? draft.picture : profile.picture ?? null;
  const dirty = draft !== null;
  const setName = (value: string) => setDraft({ name: value, picture });
  const setPicture = (value: string | null) => setDraft({ name, picture: value });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  if (!session) return null;
  return <section className="settings-card-group profile-editor">
    <details className="settings-details"><summary className="settings-group-header"><User size={16} className="settings-group-icon" />Edit profile</summary>
    <form className="settings-feature-card" onSubmit={event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(""); setFeedback("");
      const current = generation.current;
      void saveAccountProfile(session.account.id, name, picture).then(() => { if (current === generation.current) { setDraft(null); setFeedback("Profile saved."); } }).catch((e: unknown) => { if (current === generation.current) setError(e instanceof Error ? e.message : "Could not save profile."); }).finally(() => { if (current === generation.current) setBusy(false); });
    }}>
      <label htmlFor="profile-name" className="settings-feature-title">Account name</label>
      <input id="profile-name" className="settings-select-input" autoComplete="nickname" maxLength={100} required value={name} disabled={busy} onChange={event => { setName(event.target.value); setFeedback(""); }} />
      <p className="settings-feature-desc">PNG, JPEG or WebP up to 8 MB. Photos are cropped to 512 × 512 and compressed below 200 KB.</p>
      <div className="profile-photo-edit">
        {picture ? <img src={picture} alt="Profile photo preview" className="settings-profile-avatar-img" /> : <div className="settings-profile-avatar-circle">{name.trim()[0]?.toUpperCase() || "G"}</div>}
        <label className="settings-action-btn profile-photo-picker"><Camera size={16} />Choose photo<input aria-label="Choose profile photo" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          setBusy(true); setError(""); const current = generation.current;
          void prepareProfilePicture(file).then(value => { if (current === generation.current) { setPicture(value); setFeedback(""); } }).catch((e: unknown) => { if (current === generation.current) setError(e instanceof Error ? e.message : "Could not read photo."); }).finally(() => { if (current === generation.current) setBusy(false); });
        }} /></label>
        {picture && <button type="button" className="settings-action-btn" disabled={busy} onClick={() => { setPicture(null); setFeedback(""); }}>Remove photo</button>}
      </div>
      <p className="settings-feature-desc">Google accounts start with their Google name and photo; guests start as Guest. Edits stay on this device unless Cloud Sync is enabled. Photos are cropped to a square.</p>
      <button type="submit" className="settings-action-btn" disabled={busy || !dirty || !name.trim()}>{busy ? "Saving…" : "Save profile"}</button>
      <p className="settings-save-feedback" role={error ? "alert" : "status"}>{error || feedback}</p>
    </form>
    </details>
  </section>;
}
