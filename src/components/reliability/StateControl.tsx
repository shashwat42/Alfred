import { useContext } from "react";
import { AppStateContext } from "./appStateContext";

// The development module supplies the control. Production never imports it.
export function StateControl() {
  return useContext(AppStateContext)?.selector ?? null;
}
