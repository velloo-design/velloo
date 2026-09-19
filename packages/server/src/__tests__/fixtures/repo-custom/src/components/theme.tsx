import { createContext, type ReactNode, useContext } from "react";

const Accent = createContext<string | null>(null);

export function ThemeProvider({ accent, children }: { accent: string; children: ReactNode }) {
  return <Accent.Provider value={accent}>{children}</Accent.Provider>;
}

export function ThemedButton({ children }: { children?: ReactNode }) {
  const accent = useContext(Accent);
  if (!accent) throw new Error("ThemedButton must be used within a ThemeProvider");
  return (
    <button type="button" data-accent={accent}>
      {children}
    </button>
  );
}
