import { useEffect, useState } from "react";
import type { AuthSession } from "../auth/auth.ts";
import { loadAccountProfile, profileDefaults, PROFILE_CHANGED_EVENT } from "../lib/accountProfile.ts";
import { STORAGE_MODE_EVENT } from "../lib/localWorkspace.ts";
import type { AccountProfile } from "../../Alfred_Backend/src/workspace/profile.ts";

export function useAccountProfile(session: AuthSession | null) {
  const accountId = session?.account.id;
  const [saved, setSaved] = useState<{ accountId: string; profile?: AccountProfile } | null>(null);
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const load = (cloud: boolean) => { void loadAccountProfile(accountId, cloud).then(profile => { if (active) setSaved({ accountId, profile }); }).catch(() => { /* Saved identity remains usable if cloud/device storage is unavailable. */ }); };
    const local = () => load(false), cloud = () => load(true);
    load(true);
    window.addEventListener(PROFILE_CHANGED_EVENT, local); window.addEventListener(STORAGE_MODE_EVENT, cloud);
    window.addEventListener("focus", cloud);
    return () => { active = false; window.removeEventListener(PROFILE_CHANGED_EVENT, local); window.removeEventListener(STORAGE_MODE_EVENT, cloud); window.removeEventListener("focus", cloud); };
  }, [accountId]);
  const defaults = profileDefaults(session);
  const profile = saved?.accountId === accountId ? saved?.profile : undefined;
  return { name: profile?.name || defaults.name, picture: defaults.picture };
}
