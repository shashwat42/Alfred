import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/authContext";
import { API_BASE_URL, getSession } from "../../auth/auth";
import { ErrorState, Loader, NotFound } from "./States";
import { WelcomeScreen } from "./WelcomeScreen";
import { SessionRecovery } from "./SessionRecovery";
import { Legal } from "./Legal";
import { AccountPanel } from "./AccountPanel";
import { AppStateContext } from "./appStateContext";
import { StateControl } from "./StateControl";
import Logo from "../../assets/Alfred_Logo.svg";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
const StateToast = __DEV_PREVIEW__ ? lazy(() => import("../../dev/AppStates")) : null;
const StateSelector = __DEV_PREVIEW__ ? lazy(() => import("../../dev/AppStates").then(module => ({ default: module.AppStateSelector }))) : null;

export function ApplicationBoundary({ children }: { children: ReactNode }) {
  const { loading, session, error, retry, loginWithGoogle, continueAsGuest, requiresAccountChoice } = useAuth();
  const [development, setDevelopment] = useState(false), [selected, setSelected] = useState("");
  const [awaitingGoogle, setAwaitingGoogle] = useState(false);
  const welcome = <WelcomeScreen errorMessage={error ?? undefined} message={awaitingGoogle ? "Finish signing in with Google in your browser, or continue here as a guest." : undefined} guest={async () => { await continueAsGuest(); setAwaitingGoogle(false); }} google={async () => { setAwaitingGoogle(true); try { await loginWithGoogle(); } catch (e) { setAwaitingGoogle(false); throw e; } }} />;
  useEffect(() => {
    if (!__DEV_PREVIEW__) return;
    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/health`, { headers: { "ngrok-skip-browser-warning": "true" }, signal: controller.signal }).then(res => res.ok ? res.json() : null).then(data => { if (!controller.signal.aborted) setDevelopment(data?.mode === "development"); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const pathname = window.location.pathname;
  const hash = window.location.hash;
  const legal = hash === "#/privacy" || pathname === "/privacy" ? "privacy" : hash === "#/terms" || pathname === "/terms" ? "terms" : null;
  const known = ["/", "/index.html"].includes(pathname) && (!hash.startsWith("#/") || hash === "#/");
  const enabled = __DEV_PREVIEW__ && development && StateSelector && StateToast;
  const stateActive = Boolean(enabled && selected);
  const startScreen = stateActive && selected === "Start Screen";
  const selector = enabled ? <Suspense fallback={null}><StateSelector state={selected} onChange={setSelected} /></Suspense> : null;
  const brand = <div className="app-state-brand"><img src={Logo} alt="Alfred" /><strong>ALFRED</strong><StateControl /></div>;
  return <AppStateContext.Provider value={enabled ? { selected: startScreen ? selected : "", selector } : null}>
    <ConnectionStatus />
    {/* Toasts leave the live app visible. Start Screen hides it without
        unmounting the account, navigation or open drafts. */}
    <div className="live-app-surface" hidden={startScreen}>
      {selector && (legal || !known) && <header className="app-state-bar">{brand}</header>}
      {legal ? <main className="alfred-page"><a href="/">Return to Alfred</a><Legal page={legal} /></main> : !known ? <NotFound /> : awaitingGoogle && session?.account.type !== "user" ? welcome : !session ? loading ? <Loader label="Getting Alfred ready…" /> : error && getSession() ? <SessionRecovery message={error} /> : welcome : requiresAccountChoice ? welcome : <>
        {error && <ErrorState message={error} retry={retry} />}
        {!error && <AccountPanel key={session.account.id} onboardingOnly />}{children}
      </>}
    </div>
    {stateActive && StateToast && <AppStateContext.Provider value={{ selected: "", selector }}><Suspense fallback={null}><StateToast key={selected} state={selected} onChange={setSelected} /></Suspense></AppStateContext.Provider>}
  </AppStateContext.Provider>;
}
