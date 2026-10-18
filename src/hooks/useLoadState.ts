import { useCallback, useRef, useState } from "react";
/** Tracks parallel loads without erasing previously successful data. */
export function useLoadState() {
  const pending = useRef(0);
  const [isLoading, setLoading] = useState(true), [loadError, setError] = useState("");
  const [hasLoaded, setLoaded] = useState(false);
  const run = useCallback(async <T,>(load: () => Promise<T>): Promise<T> => {
    if (pending.current++ === 0) setError("");
    setLoading(true);
    try { const result = await load(); setLoaded(true); return result; }
    catch (error) { setError(error instanceof Error ? error.message : "Could not load data. Please retry."); throw error; }
    finally { if (--pending.current === 0) setLoading(false); }
  }, []);
  return { run, isLoading, loadError, hasLoaded };
}
