import type { ReactNode } from "react";
import { useAuth } from "../auth/authContext.ts";

export function OverlaySessionBoundary({ children }: { children: ReactNode }) {
  const { loading, session, requiresAccountChoice } = useAuth();
  if (!loading && session && !requiresAccountChoice) return children;
  return <div className="overlay-root w-screen h-screen flex items-start justify-center pt-2 px-4 bg-transparent">
    <div className="rounded-2xl bg-zinc-900 text-zinc-100 p-5 shadow-xl" role="status">
      {loading ? "Getting Alfred ready…" : "Open Alfred and choose Continue as guest or Continue with Google to use the overlay."}
    </div>
  </div>;
}
