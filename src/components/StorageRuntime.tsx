import { useEffect, useState } from "react";
import { ErrorNotice } from "./reliability/Notifications.tsx";

/** A failed device backup must not turn a successful cloud save into a retry. */
export function StorageRuntime() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    const changed = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener("alfred:storage-warning", changed);
    return () => window.removeEventListener("alfred:storage-warning", changed);
  }, []);
  return <ErrorNotice title="Device copy unavailable" message={message} />;
}
