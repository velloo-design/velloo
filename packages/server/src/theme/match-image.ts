import { isAbsolute, resolve } from "node:path";
import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import { derivePalette } from "./derive-palette.ts";
import { ThemeError } from "./errors.ts";

export interface MatchImageResult {
  extracted: Array<{ role: string; hex: string }>;
  theme: Theme;
  adjustments: Array<{ slot: string; from: string; to: string }>;
}

interface VibrantPalette {
  Vibrant?: { hex: string } | null;
  Muted?: { hex: string } | null;
  DarkVibrant?: { hex: string } | null;
  DarkMuted?: { hex: string } | null;
  LightVibrant?: { hex: string } | null;
  LightMuted?: { hex: string } | null;
}

/** Resolve an image path against the design folder's assets/ when relative. */
function resolveImagePath(folder: DesignFolder, p: string): string {
  if (isAbsolute(p)) return p;
  return resolve(folder.root, "assets", p);
}

export async function matchImage(
  folder: DesignFolder,
  imagePath: string,
): Promise<MatchImageResult> {
  // Lazy-load so the test suite (and headless renders) don't pull node-vibrant in.
  const { Vibrant } = await import("node-vibrant/node");
  const resolved = resolveImagePath(folder, imagePath);

  let palette: VibrantPalette;
  try {
    palette = (await Vibrant.from(resolved).getPalette()) as VibrantPalette;
  } catch (err) {
    throw new ThemeError({
      code: "IMAGE_LOAD_FAILED",
      message: `match_image: could not read ${imagePath}: ${(err as Error).message}`,
      hint: "Provide a path under assets/ or an absolute path. PNG/JPG supported.",
    });
  }

  const vibrant = palette.Vibrant?.hex ?? palette.DarkVibrant?.hex ?? palette.LightVibrant?.hex;
  if (!vibrant) {
    throw new ThemeError({
      code: "IMAGE_LOAD_FAILED",
      message: "match_image: could not extract any colors from the image",
    });
  }

  const derived = derivePalette(vibrant, folder.theme);
  const persisted = await persistTheme(folder, derived.theme);

  const extracted: MatchImageResult["extracted"] = [];
  if (palette.Vibrant?.hex) extracted.push({ role: "primary-seed", hex: palette.Vibrant.hex });
  if (palette.DarkMuted?.hex)
    extracted.push({ role: "candidate-foreground", hex: palette.DarkMuted.hex });
  if (palette.LightMuted?.hex)
    extracted.push({ role: "candidate-background", hex: palette.LightMuted.hex });
  if (palette.Muted?.hex) extracted.push({ role: "muted", hex: palette.Muted.hex });

  return { extracted, theme: persisted, adjustments: derived.adjustments };
}
