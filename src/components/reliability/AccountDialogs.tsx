import { ErrorNotice } from "./Notifications";
import { useRef, useState } from "react";
export { Onboarding } from "./OnboardingTour";
export function DeleteConfirmation({ remove, reauthenticate }: { remove: () => Promise<void>; reauthenticate?: () => void }) {
  const [confirmation, setConfirmation] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  return <section className="alfred-panel"><h2>Delete your account?</h2><p>This permanently removes your tasks, notes, schedules, preferences, onboarding, notification devices and AI usage records. Alfred sessions stop working. Your Google account is unaffected. Backup and third-party retention are described in the Privacy Policy.</p><p>Google accounts require sign-in within the last ten minutes.</p>{reauthenticate && <button disabled={busy} onClick={reauthenticate}>Sign in with Google again</button>}<label>Type DELETE to confirm<input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label><ErrorNotice message={error} /><button className="danger" disabled={confirmation !== "DELETE" || busy} onClick={async () => { if (lock.current) return; lock.current = true; setBusy(true); try { await remove(); } catch (e) { setError(e instanceof Error ? e.message : "Deletion failed. Nothing was removed. Retry when the service is available."); } finally { lock.current = false; setBusy(false); } }}>{busy ? "Deleting…" : "Permanently delete account"}</button></section>;
}
