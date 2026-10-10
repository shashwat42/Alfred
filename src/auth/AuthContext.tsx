import React, { useCallback, useEffect, useState } from "react";
import {
  AUTH_CHANGE_EVENT,
  clearSession,
  getPendingDesktopAuth,
  handleDesktopDeepLink,
  initAuthSession,
  isTauri,
  loginWithGoogle as authLoginWithGoogle,
  pollDesktopAuthStatus,
  type AuthCallback,
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

  // Listen for Tauri desktop custom protocol deep links (via plugin and single-instance event)
  useEffect(() => {
    if (!isTauri()) return;

    const unlistenFns: Array<() => void> = [];
    let active = true;

    const processIncomingDeepLink = async (rawUrl: string) => {
      if (!rawUrl) return;
      const clean = rawUrl.trim().replace(/^["']|["']$/g, "");
      if (!clean.startsWith("alfred://auth/callback") && !clean.startsWith("alfred:/auth/callback")) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const newSession = await handleDesktopDeepLink(clean);
        if (newSession && active) {
          setSession(newSession);

          // Bring the Alfred desktop window back to focus from the external browser
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const appWindow = getCurrentWindow();
            await appWindow.unminimize().catch(() => {});
            await appWindow.show().catch(() => {});
            await appWindow.setFocus().catch(() => {});
          } catch (windowErr) {
            console.warn("Failed to focus window on desktop auth callback:", windowErr);
          }
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
    };

    // 1. Listen via @tauri-apps/plugin-deep-link
    import("@tauri-apps/plugin-deep-link")
      .then(({ onOpenUrl }) => {
        if (!active) return;
        return onOpenUrl((urls) => {
          for (const url of urls) {
            processIncomingDeepLink(url);
          }
        });
      })
      .then((unlistenFn) => {
        if (active && unlistenFn) {
          unlistenFns.push(unlistenFn);
        } else if (unlistenFn) {
          unlistenFn();
        }
      })
      .catch((err) => {
        console.warn("Failed to register Tauri deep-link plugin listener:", err);
      });

    // 2. Listen via single-instance forwarded event (alfred-deep-link)
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (!active) return;
        return listen<string>("alfred-deep-link", (event) => {
          if (event.payload) {
            processIncomingDeepLink(event.payload);
          }
        });
      })
      .then((unlistenFn) => {
        if (active && unlistenFn) {
          unlistenFns.push(unlistenFn);
        } else if (unlistenFn) {
          unlistenFn();
        }
      })
      .catch((err) => {
        console.warn("Failed to register single-instance deep-link event listener:", err);
      });

    return () => {
      active = false;
      for (const fn of unlistenFns) {
        try {
          fn();
        } catch {
          // Ignore errors during unlisten cleanup
        }
      }
    };
  }, []);

  const handleLoginWithGoogle = useCallback(async (callback?: AuthCallback) => {
    // Capture pending auth state BEFORE opening the browser.
    // authLoginWithGoogle generates state+verifier then calls openUrl.
    // After openUrl resolves the browser is open but no ticket exists yet.
    await authLoginWithGoogle(callback);

    if (isTauri()) {
      // Re-read the pending state (which was saved inside authLoginWithGoogle).
      // Poll in the background — adds ~1.5s initial delay so Google can complete.
      const pending = getPendingDesktopAuth();
      if (pending) {
        pollDesktopAuthStatus(pending.state, pending.codeVerifier).then(async (newSession) => {
          if (newSession) {
            setSession(newSession);
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              const appWindow = getCurrentWindow();
              await appWindow.unminimize().catch(() => {});
              await appWindow.show().catch(() => {});
              await appWindow.setFocus().catch(() => {});
            } catch {
              // Window focus is best-effort on desktop
            }
          }
        });
      }
    }
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
        loginWithGoogle: handleLoginWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
