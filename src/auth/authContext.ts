import { createContext, useContext } from "react";
import type { AuthSession } from "./auth.ts";

export type AuthCallback = (session: AuthSession | null) => void;

export interface AuthContextType {
  session: AuthSession | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  loginWithGoogle: (callback?: AuthCallback) => Promise<void> | void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
