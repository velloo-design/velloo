/**
 * Curated vibe → seed-color table for the init wizard's vibe picker — pick
 * "playful" / "calm" / "premium" without learning OKLCH. Descended from the
 * server's retired `match_vibe` table (the LLM matcher is gone; the curated
 * seeds live on here, deterministic and offline). Seeds are hex so they
 * render as terminal swatches and flow into the same `derivePalette` path
 * the theme presets use.
 */

import type { Theme } from "@velloo/schema";
import { derivePalette } from "@velloo/server";
import { buildDefaultTheme } from "./default-theme.ts";

export interface Vibe {
  id: string;
  label: string;
  /** Seed hex — derives the palette and renders as the picker swatch. */
  seed: string;
  description: string;
}

export const VIBES: Vibe[] = [
  { id: "playful", label: "Playful", seed: "#ff614d", description: "warm orange — energetic, fun" },
  { id: "calm", label: "Calm", seed: "#0079c4", description: "muted blue — professional, stable" },
  {
    id: "natural",
    label: "Natural",
    seed: "#278733",
    description: "forest green — organic, fresh",
  },
  { id: "bold", label: "Bold", seed: "#bb061e", description: "deep red — dramatic, intense" },
  {
    id: "minimal",
    label: "Minimal",
    seed: "#2e2e2e",
    description: "near-black — monochrome, clean",
  },
  {
    id: "premium",
    label: "Premium",
    seed: "#5d57a4",
    description: "deep violet — elegant, high-end",
  },
  {
    id: "techy",
    label: "Techy",
    seed: "#00c2d4",
    description: "electric cyan — futuristic, digital",
  },
  { id: "soft", label: "Soft", seed: "#f289a3", description: "blush pink — gentle, delicate" },
  { id: "cozy", label: "Cozy", seed: "#a75c00", description: "warm amber — rustic, earthy" },
  {
    id: "sunny",
    label: "Sunny",
    seed: "#f9c718",
    description: "sun yellow — optimistic, cheerful",
  },
  { id: "moody", label: "Moody", seed: "#1d1e39", description: "deep indigo — mysterious, noir" },
  { id: "fresh", label: "Fresh", seed: "#37b78a", description: "spa mint — calming, clean" },
];

export function vibeById(id: string | undefined): Vibe | undefined {
  return id ? VIBES.find((v) => v.id === id) : undefined;
}

export function isValidVibe(id: string): boolean {
  return VIBES.some((v) => v.id === id);
}

/** Build a Theme from a vibe's seed. Falls back to the default theme for an unknown id. */
export function buildVibeTheme(id: string | undefined, name = "default"): Theme {
  const base = buildDefaultTheme();
  const vibe = vibeById(id);
  if (!vibe) return { ...base, name };
  const derived = derivePalette(vibe.seed, base, name);
  return derived.ok ? derived.value.theme : { ...base, name };
}
