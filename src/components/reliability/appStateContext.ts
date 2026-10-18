import { createContext, type ReactNode } from "react";
export const AppStateContext = createContext<{ selected: string; selector: ReactNode } | null>(null);
