import { ErrorNotice } from "./Notifications";
import { useState } from "react";
import { useAuth } from "../../auth/authContext";
import { StateCard } from "./States";

export function SessionRecovery({ message }: { message: string }) {
  const { continueAsGuest, retry, loginWithGoogle, loading } = useAuth();
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState("");
  return <StateCard title="Let’s get you back to Alfred">
    <ErrorNotice message={message} retry={retry} /><p>Google sign-in is optional. Continuing as a new guest keeps the previous account’s data on the server and preserves its saved credential on this device.</p>
    <button disabled={busy || loading} onClick={() => void continueAsGuest()}>Continue as guest</button>{" "}
    <button disabled={busy || loading} onClick={retry}>Retry existing session</button>{" "}
    <button disabled={busy || loading} onClick={async () => { setBusy(true); setActionError(""); try { await loginWithGoogle(); } catch (error) { setActionError(error instanceof Error ? error.message : "Could not start Google sign-in."); } finally { setBusy(false); } }}>Sign in with Google (optional)</button>
    <ErrorNotice message={actionError} />
  </StateCard>;
}
