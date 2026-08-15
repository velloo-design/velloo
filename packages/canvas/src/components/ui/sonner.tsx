import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useCanvas } from "@/store";

function effectiveTheme(appTheme: "light" | "dark" | "system"): "light" | "dark" {
  if (appTheme !== "system") return appTheme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function Toaster(props: ToasterProps) {
  const appTheme = useCanvas((s) => s.appTheme);
  const theme = effectiveTheme(appTheme);
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
