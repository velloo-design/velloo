import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Theme } from "@velloo/schema";
import {
  expandStylesheetImports,
  findFontLoader,
  mergeThemeCss,
  type NotImported,
  nearestTailwindConfigFile,
} from "@velloo/server";
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
  /** Families set from the app's font loader calls (`next/font`), in role order. */
  fonts: string[];
  /** What the app states that the import could not carry — the agent's setup picks these up. */
  notImported: NotImported[];
  /**
   * Every file the theme was read from, absolute, the stylesheet first: the
   * sheets it imports, the tailwind.config it merged and the modules whose
   * font loader calls set a face.
   */
  read: string[];
}

/**
 * The starter theme with its faces taken out. The starter's DM Sans and DM
 * Serif Display are a look of their own, and under an app's colours they read
 * as the app's fonts being wrong. What an app that names no `sans` actually
 * renders in is the system stack, so that is where an import starts from; the
 * faces the import finds then replace it.
 */
export function withoutStarterFaces(theme: Theme): Theme {
  const sans = "ui-sans-serif, system-ui, sans-serif";
  return {
    ...theme,
    typography: {
      ...theme.typography,
      fontFamily: {
        ...theme.typography.fontFamily,
        sans,
        display: sans,
        mono: "ui-monospace, SFMono-Regular, monospace",
      },
      googleFonts: [],
    },
  };
}

/**
 * The package the stylesheet belongs to: where its layout and font loader
 * calls are. In a monorepo that is a workspace below `appRoot`, not the root.
 */
function packageRootOf(cssPath: string, appRoot: string): string {
  let dir = dirname(cssPath);
  while (dir.startsWith(appRoot) && dir !== appRoot) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return appRoot;
}

/**
 * Read the host app's global stylesheet and merge its theme onto a base preset,
 * so the canvas opens in the user's real brand. This is the merge `import_theme`
 * runs (`mergeThemeCss`): semantic slots, the app's own palette, radius,
 * shadows, the nearby tailwind.config's `theme.extend`, and the fonts — a
 * family `next/font` sets at runtime included, traced to the loader call in the
 * app's layout. The stylesheet an app points at is often only an entry point
 * (`@import "tailwindcss"; @import "./theme.css";`), so the sheets it imports by
 * relative path inside `appRoot` are read as part of it. Returns null when the
 * file is unreadable or carries no slot, radius or font, so the caller falls
 * back to the preset.
 */
export function importThemeFromGlobals(
  cssPath: string,
  appRoot: string,
  presetId?: string,
): ImportedStylesheetTheme | null {
  if (!existsSync(cssPath)) return null;
  const { css, followed } = expandStylesheetImports(cssPath, { root: appRoot });
  const tailwindConfig = nearestTailwindConfigFile(cssPath);
  const packageRoot = packageRootOf(cssPath, appRoot);
  const merged = mergeThemeCss(withoutStarterFaces(buildPresetTheme(presetId, "default")), css, {
    ...(tailwindConfig !== null ? { tailwindConfig: tailwindConfig.source } : {}),
    fontLoader: (cssVar) => findFontLoader(packageRoot, cssVar),
  });
  if (!merged.ok || merged.value.tokenless) return null;
  const { theme, changes, coverage, fonts, notImported, warnings } = merged.value;
  // Colours the app names on its own convention land in `palette` and theme
  // nothing: a design that opened on them would still be the preset's.
  const themed = changes.some((change) => /^(radius|typography)\./.test(change.token));
  if (coverage.semantic === 0 && !themed) return null;
  return {
    theme,
    importedFrom: cssPath,
    followed,
    tokenCount: coverage.semantic + coverage.palette,
    fonts: fonts.map((font) => font.family),
    notImported,
    warnings,
    read: [
      cssPath,
      ...followed,
      ...(tailwindConfig ? [tailwindConfig.path] : []),
      ...fonts.map((font) => join(packageRoot, font.from)),
    ],
  };
}
