import React, { useCallback, useEffect, useState } from "react";
import {
  AUTH_CHANGE_EVENT,
  clearSession,
  handleDesktopDeepLink,
  initAuthSession,
  isTauri,
  loginWithGoogle,
  type AuthSession,
} from "./auth.ts";
import { AuthContext } from "./authContext.ts";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Incrementing this counter re-triggers the auth init effect.
  const [retryCount, setRetryCount] = useState(0);

  // retry() resets UI state synchronously here (in a user callback, not an
  // effect body), then bumps retryCount so the effect below re-runs.
  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    // Local flag prevents setState from firing after this effect has cleaned up
    // (e.g. component unmounts during an in-flight request, or retry fires again).
    let cancelled = false;

    initAuthSession()
      .then((activeSession) => {
        if (!cancelled) {
          setSession(activeSession);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("Authentication initialization failed:", err);
          setSession(null);
          setError(
            err instanceof Error
              ? err.message
              : "Failed to initialize authentication session."
          );
          setLoading(false);
        }
      });

    const handleAuthChange = (event: Event) => {
      const customEvent = event as CustomEvent<AuthSession | null>;
      if (!cancelled) {
        setSession(customEvent.detail ?? null);
        setLoading(false);
      }
    };

    window.addEventListener(AUTH_CHANGE_EVENT, handleAuthChange);

    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
    };
  }, [retryCount]);

  // Listen for Tauri desktop custom protocol deep links (e.g. alfred://auth/callback)
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let active = true;

    import("@tauri-apps/plugin-deep-link")
      .then(({ onOpenUrl }) => {
        if (!active) return;
        return onOpenUrl(async (urls) => {
          for (const url of urls) {
            if (url.startsWith("alfred://auth/callback")) {
              setLoading(true);
              setError(null);
              try {
                const newSession = await handleDesktopDeepLink(url);
                if (newSession && active) {
                  setSession(newSession);
                }
              } catch (err) {
                if (active) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Desktop authentication failed."
                  );
                }
              } finally {
                if (active) {
                  setLoading(false);
                }
              }
            }
          }
        });
      })
      .then((unlistenFn) => {
        if (active && unlistenFn) {
          unlisten = unlistenFn;
        } else if (unlistenFn) {
          unlistenFn();
        }
      })
      .catch((err) => {
        console.warn("Failed to register Tauri deep-link listener:", err);
      });

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  const logout = () => {
    clearSession();
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        error,
        retry,
        loginWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
