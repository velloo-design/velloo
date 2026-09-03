import { err, ok, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { type ThemeError, unknownPreset } from "./errors.ts";
import { PRESETS } from "./presets.ts";

export async function applyPreset(
  folder: DesignFolder,
  presetName: string,
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  const preset = PRESETS[presetName];
  if (!preset) {
    return err(unknownPreset(presetName, `Known presets: ${Object.keys(PRESETS).join(", ")}`));
  }
  return ok(await persistNamedTheme(folder, themeName, { ...preset }));
}
