import type { Theme } from "@velloo/schema";

export function buildDefaultTheme(): Theme {
  return {
    name: "default",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: {
        DEFAULT: "oklch(0.205 0 0)",
        foreground: "oklch(0.985 0 0)",
      },
      secondary: {
        DEFAULT: "oklch(0.97 0 0)",
        foreground: "oklch(0.205 0 0)",
      },
      muted: {
        DEFAULT: "oklch(0.97 0 0)",
        foreground: "oklch(0.556 0 0)",
      },
      accent: {
        DEFAULT: "oklch(0.97 0 0)",
        foreground: "oklch(0.205 0 0)",
      },
      destructive: {
        DEFAULT: "oklch(0.577 0.245 27.325)",
        foreground: "oklch(0.985 0 0)",
      },
      card: {
        DEFAULT: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
      },
      popover: {
        DEFAULT: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
      },
      border: "oklch(0.922 0 0)",
      input: "oklch(0.922 0 0)",
      ring: "oklch(0.708 0 0)",
    },
    typography: {
      fontFamily: {
        sans: "Inter, ui-sans-serif, system-ui, sans-serif",
        mono: "ui-monospace, SFMono-Regular, monospace",
      },
      fontSize: {
        xs: 12,
        sm: 14,
        base: 16,
        lg: 18,
        xl: 20,
        "2xl": 24,
        "3xl": 30,
        "4xl": 36,
      },
      lineHeight: {
        tight: 1.2,
        normal: 1.5,
        relaxed: 1.75,
      },
    },
    spacing: {
      0: 0,
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      6: 24,
      8: 32,
      12: 48,
      16: 64,
    },
    radius: {
      sm: 4,
      md: 6,
      lg: 8,
      xl: 12,
      full: 9999,
    },
  };
}
