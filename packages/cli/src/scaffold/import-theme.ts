import { readFileSync } from "node:fs";
import { parseThemeCss } from "@velloo/codegen";
import type { Theme } from "@velloo/schema";
import { buildPresetTheme } from "./theme-presets.ts";

export interface ImportedTheme {
  theme: Theme;
  importedFrom: string;
  /** Number of color tokens pulled from the host stylesheet. */
  tokenCount: number;
  warnings: string[];
}

/**
 * Read the host app's global stylesheet and merge its theme tokens onto a
 * base preset theme, so the canvas renders in the user's real brand. The
 * parser (codegen) understands both the v3 HSL-triplet and v4 oklch/@theme
 * conventions. Returns null when the file is unreadable or carries no
 * recognizable tokens, so the caller falls back to the preset.
 */
export function importThemeFromGlobals(cssPath: string, presetId?: string): ImportedTheme | null {
  let css: string;
  try {
    css = readFileSync(cssPath, "utf8");
  } catch {
    return null;
  }

  const parsed = parseThemeCss(css);
  const tokenCount = Object.keys(parsed.colors).length + Object.keys(parsed.colorsDark).length;
  if (tokenCount === 0 && parsed.radius === undefined && parsed.fontFamily === undefined) {
    return null;
  }

  const base = buildPresetTheme(presetId, "default");
  const theme: Theme = {
    ...base,
    colors: { ...base.colors, ...parsed.colors },
    colorsDark: { ...(base.colorsDark ?? {}), ...parsed.colorsDark },
    radius: parsed.radius !== undefined ? { ...base.radius, md: parsed.radius } : base.radius,
    typography: parsed.fontFamily
      ? {
          ...base.typography,
          fontFamily: { ...base.typography.fontFamily, ...parsed.fontFamily },
        }
      : base.typography,
  };

  return { theme, importedFrom: cssPath, tokenCount, warnings: parsed.warnings };
}
