import { useEffect } from "react";
import { type AppTheme, useCanvas } from "./store.ts";

function effectiveTheme(appTheme: AppTheme): "light" | "dark" {
  if (appTheme !== "system") return appTheme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Mirror the app theme onto <html data-app-theme="..."> and re-apply on OS changes. */
export function useApplyAppTheme(): void {
  const appTheme = useCanvas((s) => s.appTheme);

  useEffect(() => {
    const apply = () => {
      const t = effectiveTheme(appTheme);
      document.documentElement.dataset.appTheme = t;
    };
    apply();

    if (appTheme !== "system") return undefined;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appTheme]);
}
