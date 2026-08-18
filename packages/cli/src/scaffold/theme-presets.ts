/**
 * Built-in theme presets for `velloo init`. Each is a seed color the
 * wizard shows as a swatch; the full light + dark palette is derived from
 * it via the same `derivePalette` the canvas's theme panel uses, so a
 * preset and a hand-tuned theme are the same shape. `indigo` is the Pulse
 * default and short-circuits to the curated JSON rather than re-deriving.
 */

import type { Theme } from "@velloo/schema";
import { derivePalette } from "@velloo/server";
import { buildDefaultTheme } from "./default-theme.ts";

export interface ThemePreset {
  id: string;
  label: string;
  /** Seed hex — derives the palette and renders as the picker swatch. */
  seed: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "indigo", label: "Indigo (Pulse default)", seed: "#5e6ad2" },
  { id: "violet", label: "Violet", seed: "#7c3aed" },
  { id: "blue", label: "Blue", seed: "#2563eb" },
  { id: "emerald", label: "Emerald", seed: "#059669" },
  { id: "rose", label: "Rose", seed: "#e11d48" },
  { id: "orange", label: "Orange", seed: "#ea580c" },
  { id: "amber", label: "Amber", seed: "#d97706" },
  { id: "zinc", label: "Zinc (neutral)", seed: "#52525b" },
];

export const DEFAULT_THEME_PRESET = "indigo";

export function presetById(id: string | undefined): ThemePreset | undefined {
  return id ? THEME_PRESETS.find((p) => p.id === id) : undefined;
}

export function isValidPreset(id: string): boolean {
  return THEME_PRESETS.some((p) => p.id === id);
}

/**
 * Build a Theme for a preset id, named `name`. Falls back to the Pulse
 * default theme for an unknown id or the `indigo` default.
 */
export function buildPresetTheme(id: string | undefined, name = "default"): Theme {
  const base = buildDefaultTheme();
  const preset = presetById(id);
  if (!preset || preset.id === DEFAULT_THEME_PRESET) return { ...base, name };
  const derived = derivePalette(preset.seed, base, name);
  return derived.ok ? derived.value.theme : { ...base, name };
}
