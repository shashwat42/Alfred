import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/authContext";
import { apiJson } from "../../lib/api";
import { clearSession } from "../../auth/auth";
import { Usage, type AccountStatus } from "./Usage";
import { Modal, ErrorState } from "./States";
import { Onboarding, DeleteConfirmation } from "./AccountDialogs";
import { Legal } from "./Legal";
import { UserRound } from "lucide-react";
import { CloudStorageSettings } from "../dashboard/CloudStorageSettings.tsx";
import { deleteLocalWorkspace } from "../../lib/localWorkspace.ts";

export function AccountPanel({ onboardingOnly = false }: { onboardingOnly?: boolean }) {
  const { session, loginWithGoogle } = useAuth();
  const accountId = session?.account.id;
  const [data, setData] = useState<AccountStatus | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [dialog, setDialog] = useState<"privacy" | "terms" | "delete" | null>(null);
  const [revisiting, setRevisiting] = useState(false);
  const serverDeleted = useRef(false);
  const removeAccount = async () => {
    if (!accountId) return;
    if (!serverDeleted.current) {
      await apiJson<void>("/api/account", { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE" }), _expectedAccountId: accountId });
      serverDeleted.current = true;
    }
    try { await deleteLocalWorkspace(accountId); }
    catch { throw new Error("The server account was deleted, but this device’s copy could not be cleared. Retry to finish removing the local copy."); }
    clearSession(); window.location.href = "/";
  };
  useEffect(() => {
    if (!onboardingOnly || !accountId) return;
    const revisit = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== accountId) return;
      setDialog(null);
      setRevisiting(true);
    };
    window.addEventListener("alfred:revisit-setup", revisit);
    return () => window.removeEventListener("alfred:revisit-setup", revisit);
  }, [accountId, onboardingOnly]);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!accountId || inFlight.current) return;
    inFlight.current = true; setLoading(true); setError("");
    try { setData(await apiJson<AccountStatus>("/api/account", { _expectedAccountId: accountId })); }
    catch (e) { setError(e instanceof Error ? e.message : "Usage unavailable."); }
    finally { inFlight.current = false; setLoading(false); }
  }, [accountId]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  const complete = async () => {
    await apiJson<void>("/api/account/onboarding", { method: "PUT", body: JSON.stringify({ completed: true }), _expectedAccountId: accountId });
    setData(previous => previous ? { ...previous, onboardingCompleted: true } : previous); setDialog(null); setRevisiting(false);
  };
  if (!accountId) return null;
  if (onboardingOnly && !revisiting) {
    if (loading) return null;
    if (error) return <ErrorState message={error} retry={() => void refresh()} />;
    if (!data || data.onboardingCompleted) return null;
  }
  const openSetup = onboardingOnly;
  return <>
    {!onboardingOnly && <CloudStorageSettings key={accountId} refresh={() => void refresh()} />}
    {!onboardingOnly && <><Usage data={data} loading={loading} error={error} refresh={() => void refresh()} /><section className="settings-card-group account-management"><h3 className="settings-group-header"><UserRound size={16} className="settings-group-icon" />Account management</h3><div className="settings-feature-card account-management-card"><div className="account-management-actions"><button className="settings-action-btn" onClick={() => window.dispatchEvent(new CustomEvent("alfred:revisit-setup", { detail: accountId }))}>Revisit setup</button><button className="settings-action-btn" onClick={() => setDialog("privacy")}>Privacy Policy</button><button className="settings-action-btn" onClick={() => setDialog("terms")}>Terms of Service</button><button className="settings-action-btn account-management-delete" onClick={() => setDialog("delete")}>Delete account</button></div></div></section></>}
    {openSetup && !["privacy", "terms"].includes(dialog ?? "") && <Onboarding interactive complete={complete} legal={setDialog} />}
    {(dialog === "privacy" || dialog === "terms") && <Modal title={dialog === "privacy" ? "Privacy Policy" : "Terms of Service"} onClose={() => setDialog(null)}><Legal page={dialog} /></Modal>}
    {dialog === "delete" && <Modal title="Delete account" onClose={() => setDialog(null)}><DeleteConfirmation reauthenticate={session?.account.type === "user" ? () => void loginWithGoogle() : undefined} remove={removeAccount} /></Modal>}
  </>;
}
