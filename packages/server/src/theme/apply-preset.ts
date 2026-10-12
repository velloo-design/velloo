import { err, ok, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { derivePalette, isDarkColor } from "./derive-palette.ts";
import { type ThemeError, unknownPreset } from "./errors.ts";
import { PRESETS } from "./presets.ts";

/**
 * A preset states one palette. Applied as it stands, the theme it replaces
 * loses its dark colors and a dark frame renders exactly like a light one — so
 * a light preset gets a dark palette grown from its own primary. One that is
 * dark to begin with is left as it is.
 */
function withDarkPalette(preset: Theme): Theme {
  if (preset.colorsDark || isDarkColor(preset.colors.background)) return preset;
  const primary = preset.colors.primary;
  const derived = derivePalette(typeof primary === "string" ? primary : primary.DEFAULT, preset);
  return derived.ok && derived.value.theme.colorsDark
    ? { ...preset, colorsDark: derived.value.theme.colorsDark }
    : preset;
}

export async function applyPreset(
  folder: DesignFolder,
  presetName: string,
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  const preset = PRESETS[presetName];
  if (!preset) {
    return err(unknownPreset(presetName, `Known presets: ${Object.keys(PRESETS).join(", ")}`));
  }
  return ok(await persistNamedTheme(folder, themeName, withDarkPalette(preset)));
}
