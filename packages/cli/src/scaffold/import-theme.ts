import { existsSync } from "node:fs";
import { importedRadius, parseThemeCss } from "@velloo/codegen";
import type { Theme } from "@velloo/schema";
import { expandStylesheetImports } from "@velloo/server";
import { buildPresetTheme } from "./theme-presets.ts";

export interface ImportedTheme {
  theme: Theme;
  importedFrom: string;
  /** Number of color tokens pulled from the host stylesheet. */
  tokenCount: number;
  warnings: string[];
}

interface ImportedStylesheetTheme extends ImportedTheme {
  /** Stylesheets `importedFrom` imports by relative path, read as part of it. */
  followed: string[];
}

/**
 * Read the host app's global stylesheet and merge its theme tokens onto a
 * base preset theme, so the canvas renders in the user's real brand. The
 * parser (codegen) understands both the v3 HSL-triplet and v4 oklch/@theme
 * conventions. The stylesheet an app points at is often only an entry point
 * (`@import "tailwindcss"; @import "./theme.css";`), so the sheets it imports
 * by relative path inside `appRoot` are read as part of it. Returns null when
 * the file is unreadable or none of that carries a recognizable token, so the
 * caller falls back to the preset.
 */
export function importThemeFromGlobals(
  cssPath: string,
  appRoot: string,
  presetId?: string,
): ImportedStylesheetTheme | null {
  if (!existsSync(cssPath)) return null;
  const { css, followed } = expandStylesheetImports(cssPath, { root: appRoot });

  const parsed = parseThemeCss(css);
  const tokenCount = Object.keys(parsed.colors).length + Object.keys(parsed.colorsDark).length;
  if (
    tokenCount === 0 &&
    parsed.radius === undefined &&
    parsed.radiusScale === undefined &&
    parsed.fontFamily === undefined
  ) {
    return null;
  }

  const base = buildPresetTheme(presetId, "default");
  const theme: Theme = {
    ...base,
    colors: { ...base.colors, ...parsed.colors },
    colorsDark: { ...(base.colorsDark ?? {}), ...parsed.colorsDark },
    radius: importedRadius(base.radius, parsed),
    ...(parsed.shadows ? { shadows: { ...(base.shadows ?? {}), ...parsed.shadows } } : {}),
    typography: parsed.fontFamily
      ? {
          ...base.typography,
          fontFamily: { ...base.typography.fontFamily, ...parsed.fontFamily },
        }
      : base.typography,
  };

  return { theme, importedFrom: cssPath, followed, tokenCount, warnings: parsed.warnings };
}
