import type { Theme } from "@velloo/schema";

const baseTypography = {
  fontFamily: {
    sans: "Inter, ui-sans-serif, system-ui, sans-serif",
    mono: "ui-monospace, SFMono-Regular, monospace",
  },
  fontSize: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36 },
  lineHeight: { tight: 1.2, normal: 1.5, relaxed: 1.75 },
};
const baseSpacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64 };
const baseRadius = { sm: 4, md: 6, lg: 8, xl: 12, full: 9999 };

/**
 * 5 V0 presets. Each is a complete Theme so apply_preset can replace wholesale
 * without merging. Use the derive-palette flow if you want a different seed.
 */
export const PRESETS: Record<string, Theme> = {
  "default-light": {
    name: "default-light",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
      secondary: { DEFAULT: "oklch(0.97 0 0)", foreground: "oklch(0.205 0 0)" },
      muted: { DEFAULT: "oklch(0.97 0 0)", foreground: "oklch(0.556 0 0)" },
      accent: { DEFAULT: "oklch(0.97 0 0)", foreground: "oklch(0.205 0 0)" },
      destructive: { DEFAULT: "oklch(0.577 0.245 27.325)", foreground: "oklch(0.985 0 0)" },
      card: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.145 0 0)" },
      popover: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.145 0 0)" },
      border: "oklch(0.922 0 0)",
      input: "oklch(0.922 0 0)",
      ring: "oklch(0.708 0 0)",
    },
    typography: baseTypography,
    spacing: baseSpacing,
    radius: baseRadius,
  },
  "default-dark": {
    name: "default-dark",
    colors: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      primary: { DEFAULT: "oklch(0.985 0 0)", foreground: "oklch(0.205 0 0)" },
      secondary: { DEFAULT: "oklch(0.269 0 0)", foreground: "oklch(0.985 0 0)" },
      muted: { DEFAULT: "oklch(0.269 0 0)", foreground: "oklch(0.708 0 0)" },
      accent: { DEFAULT: "oklch(0.269 0 0)", foreground: "oklch(0.985 0 0)" },
      destructive: { DEFAULT: "oklch(0.396 0.141 25.723)", foreground: "oklch(0.985 0 0)" },
      card: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
      popover: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
      border: "oklch(0.269 0 0)",
      input: "oklch(0.269 0 0)",
      ring: "oklch(0.439 0 0)",
    },
    typography: baseTypography,
    spacing: baseSpacing,
    radius: baseRadius,
  },
  violet: {
    name: "violet",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.205 0 0)",
      primary: { DEFAULT: "oklch(0.55 0.22 290)", foreground: "oklch(0.985 0.01 290)" },
      secondary: { DEFAULT: "oklch(0.96 0.02 290)", foreground: "oklch(0.222 0.05 290)" },
      muted: { DEFAULT: "oklch(0.96 0.02 290)", foreground: "oklch(0.55 0.04 290)" },
      accent: { DEFAULT: "oklch(0.92 0.05 290)", foreground: "oklch(0.222 0.05 290)" },
      destructive: { DEFAULT: "oklch(0.577 0.245 27.325)", foreground: "oklch(0.985 0 0)" },
      card: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      popover: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      border: "oklch(0.92 0.02 290)",
      input: "oklch(0.92 0.02 290)",
      ring: "oklch(0.55 0.22 290)",
    },
    typography: baseTypography,
    spacing: baseSpacing,
    radius: baseRadius,
  },
  emerald: {
    name: "emerald",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.205 0 0)",
      primary: { DEFAULT: "oklch(0.5 0.18 155)", foreground: "oklch(0.985 0.01 155)" },
      secondary: { DEFAULT: "oklch(0.96 0.02 155)", foreground: "oklch(0.222 0.05 155)" },
      muted: { DEFAULT: "oklch(0.96 0.02 155)", foreground: "oklch(0.55 0.04 155)" },
      accent: { DEFAULT: "oklch(0.92 0.06 155)", foreground: "oklch(0.222 0.05 155)" },
      destructive: { DEFAULT: "oklch(0.577 0.245 27.325)", foreground: "oklch(0.985 0 0)" },
      card: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      popover: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      border: "oklch(0.92 0.02 155)",
      input: "oklch(0.92 0.02 155)",
      ring: "oklch(0.5 0.18 155)",
    },
    typography: baseTypography,
    spacing: baseSpacing,
    radius: baseRadius,
  },
  amber: {
    name: "amber",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.205 0 0)",
      primary: { DEFAULT: "oklch(0.72 0.18 70)", foreground: "oklch(0.222 0.04 70)" },
      secondary: { DEFAULT: "oklch(0.96 0.03 70)", foreground: "oklch(0.222 0.05 70)" },
      muted: { DEFAULT: "oklch(0.96 0.03 70)", foreground: "oklch(0.55 0.04 70)" },
      accent: { DEFAULT: "oklch(0.93 0.08 70)", foreground: "oklch(0.222 0.05 70)" },
      destructive: { DEFAULT: "oklch(0.577 0.245 27.325)", foreground: "oklch(0.985 0 0)" },
      card: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      popover: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      border: "oklch(0.92 0.03 70)",
      input: "oklch(0.92 0.03 70)",
      ring: "oklch(0.72 0.18 70)",
    },
    typography: baseTypography,
    spacing: baseSpacing,
    radius: baseRadius,
  },
  rose: {
    name: "rose",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.205 0 0)",
      primary: { DEFAULT: "oklch(0.585 0.197 16.5)", foreground: "oklch(0.99 0.005 17)" },
      secondary: { DEFAULT: "oklch(0.97 0.012 17)", foreground: "oklch(0.222 0.04 17)" },
      muted: { DEFAULT: "oklch(0.96 0.012 17)", foreground: "oklch(0.55 0.04 17)" },
      accent: { DEFAULT: "oklch(0.95 0.025 17)", foreground: "oklch(0.222 0.04 17)" },
      destructive: { DEFAULT: "oklch(0.577 0.245 27.325)", foreground: "oklch(0.985 0 0)" },
      card: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      popover: { DEFAULT: "oklch(1 0 0)", foreground: "oklch(0.205 0 0)" },
      border: "oklch(0.92 0.012 17)",
      input: "oklch(0.92 0.012 17)",
      ring: "oklch(0.585 0.197 16.5)",
    },
    typography: baseTypography,
    spacing: baseSpacing,
    radius: baseRadius,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);
