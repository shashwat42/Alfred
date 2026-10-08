import { createContext, useContext } from "react";
import type { AuthSession } from "./auth.ts";

export interface AuthContextType {
  session: AuthSession | null;
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
  loginWithGoogle: () => void;
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
