import React, { useCallback, useEffect, useState } from "react";
import {
  AUTH_CHANGE_EVENT,
  clearSession,
  initAuthSession,
  loginWithGoogle,
  type AuthSession,
} from "./auth.ts";
import { AuthContext } from "./authContext.ts";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const activeSession = await initAuthSession();
      setSession(activeSession);
    } catch (err) {
      console.error("Authentication initialization failed:", err);
      setSession(null);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to initialize authentication session."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    initAuthSession()
      .then((activeSession) => {
        if (isMounted) {
          setSession(activeSession);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
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
      if (isMounted) {
        setSession(customEvent.detail ?? null);
        setLoading(false);
      }
    };

    window.addEventListener(AUTH_CHANGE_EVENT, handleAuthChange);

    return () => {
      isMounted = false;
      window.removeEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
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
        retry: init,
        loginWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
