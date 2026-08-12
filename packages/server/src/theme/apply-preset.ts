import { err, ok, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import { type ThemeError, unknownPreset } from "./errors.ts";
import { PRESETS } from "./presets.ts";

export async function applyPreset(
  folder: DesignFolder,
  presetName: string,
): Promise<Result<Theme, ThemeError>> {
  const preset = PRESETS[presetName];
  if (!preset) {
    return err(unknownPreset(presetName, `Known presets: ${Object.keys(PRESETS).join(", ")}`));
  }
  return ok(await persistTheme(folder, { ...preset }));
}
