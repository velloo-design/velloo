import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import { ThemeError } from "./errors.ts";
import { PRESETS } from "./presets.ts";

export async function applyPreset(folder: DesignFolder, presetName: string): Promise<Theme> {
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new ThemeError({
      code: "UNKNOWN_PRESET",
      message: `Unknown preset: ${JSON.stringify(presetName)}`,
      hint: `Known presets: ${Object.keys(PRESETS).join(", ")}`,
    });
  }
  // Preserve the existing theme name unless the preset is explicitly named.
  return persistTheme(folder, { ...preset });
}
