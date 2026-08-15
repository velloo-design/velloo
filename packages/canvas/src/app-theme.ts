import { useEffect } from "react";
import { type AppTheme, useCanvas } from "./store.ts";

function effectiveTheme(appTheme: AppTheme): "light" | "dark" {
  if (appTheme !== "system") return appTheme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Mirror the app theme onto <html class="dark"> and re-apply on OS changes.
 * Uses shadcn's `.dark` class convention so Tailwind v4 `@custom-variant dark`
 * fires on the chrome (decoupled from the design's own theme inside iframes).
 */
export function useApplyAppTheme(): void {
  const appTheme = useCanvas((s) => s.appTheme);

  useEffect(() => {
    const apply = () => {
      const t = effectiveTheme(appTheme);
      document.documentElement.classList.toggle("dark", t === "dark");
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
