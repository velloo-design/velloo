import { readFileSync } from "node:fs";
import type { Colors, Theme } from "@velloo/schema";
import { findModule } from "./find-module.ts";
import { type ImportedTheme, withoutStarterFaces } from "./import-theme.ts";
import { asNumber, asObject, asString, callArgument, prop } from "./object-literal.ts";
import { buildPresetTheme } from "./theme-presets.ts";

interface ImportedMuiTheme extends ImportedTheme {
  /** The family the theme's `typography.fontFamily` leads with; empty when it names none. */
  fonts: string[];
}

/** Generic names and faces every machine has: nothing the app chose to load. */
const SYSTEM_FAMILY =
  /^(?:-apple-system|BlinkMacSystemFont|system-ui|ui-[a-z-]+|sans-serif|serif|monospace|Segoe UI|Helvetica(?: Neue)?|Arial)$/i;

/**
 * Read a MUI theme module — a `createTheme({ palette, shape, typography })`
 * call — and project its `ThemeOptions` back onto velloo's token tree (the
 * inverse of provider-mui's `muiThemeOptions`). Best-effort + side-effect-free:
 * only inline string/number literals are read, and an unparseable or
 * non-literal theme returns null so the caller falls back to the preset.
 *
 * The "existing project" flow's theme import for MUI apps, the counterpart to
 * `importThemeFromGlobals`.
 */
export function importThemeFromMui(filePath: string, presetId?: string): ImportedMuiTheme | null {
  let src: string;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const root = callArgument(src, "createTheme");
  if (!root) return null;
  const palette = asObject(prop(root, "palette"));

  const colors: Partial<Colors> = {};
  const warnings: string[] = [];
  let tokenCount = 0;

  if (palette) {
    const pairOf = (
      key: string,
    ): { main?: string | undefined; contrastText?: string | undefined } => {
      const o = asObject(prop(palette, key));
      return {
        main: o && asString(prop(o, "main")),
        contrastText: o && asString(prop(o, "contrastText")),
      };
    };
    const text = asObject(prop(palette, "text"));
    const textPrimary = text && asString(prop(text, "primary"));

    const primary = pairOf("primary");
    if (primary.main) {
      colors.primary = { DEFAULT: primary.main, foreground: primary.contrastText ?? "#ffffff" };
      tokenCount++;
    }
    const secondary = pairOf("secondary");
    if (secondary.main) {
      colors.secondary = {
        DEFAULT: secondary.main,
        foreground: secondary.contrastText ?? "#ffffff",
      };
      tokenCount++;
    }
    const error = pairOf("error");
    if (error.main) {
      colors.destructive = { DEFAULT: error.main, foreground: error.contrastText ?? "#ffffff" };
      tokenCount++;
    }
    const background = asObject(prop(palette, "background"));
    const bgDefault = background && asString(prop(background, "default"));
    const bgPaper = background && asString(prop(background, "paper"));
    if (bgDefault) {
      colors.background = bgDefault;
      tokenCount++;
    }
    // velloo's `card` is a surface pair; MUI's paper has no on-color, so use the
    // primary text color (text on a paper surface) for its foreground.
    if (bgPaper) {
      colors.card = { DEFAULT: bgPaper, foreground: textPrimary ?? "#111827" };
      tokenCount++;
    }
    if (textPrimary) {
      colors.foreground = textPrimary;
      tokenCount++;
    }
    const divider = asString(prop(palette, "divider"));
    if (divider) {
      colors.border = divider;
      tokenCount++;
    }
    // `text.secondary` maps to muted-foreground, but velloo's `muted` also needs
    // a surface color MUI doesn't define — left to the base preset rather than
    // inventing one.
  }

  const shape = asObject(prop(root, "shape"));
  const borderRadius = shape && asNumber(prop(shape, "borderRadius"));
  const typography = asObject(prop(root, "typography"));
  const fontFamily = typography && asString(prop(typography, "fontFamily"));

  if (tokenCount === 0 && borderRadius === undefined && fontFamily === undefined) {
    return null;
  }

  // Not the starter's faces: an app whose theme names no font is on MUI's
  // stack, which is nearer the system's than DM Sans and DM Serif Display.
  const base = withoutStarterFaces(buildPresetTheme(presetId, "default"));
  const theme: Theme = {
    ...base,
    colors: { ...base.colors, ...colors },
    radius: borderRadius !== undefined ? { ...base.radius, md: borderRadius } : base.radius,
    // MUI sets headings in the body's family unless a variant says otherwise.
    typography: fontFamily
      ? {
          ...base.typography,
          fontFamily: { ...base.typography.fontFamily, sans: fontFamily, display: fontFamily },
        }
      : base.typography,
  };
  const lead = fontFamily
    ?.split(",")[0]
    ?.trim()
    .replace(/^["'`]|["'`]$/g, "");
  const fonts = lead && !SYSTEM_FAMILY.test(lead) ? [lead] : [];

  return { theme, importedFrom: filePath, tokenCount, warnings, fonts };
}

/**
 * The module a MUI app's theme is in: the first that imports from `@mui/` and
 * calls `createTheme` with an object literal — a `theme.ts`, or the call made
 * inline where the app renders its `ThemeProvider` (`main.tsx`, `App.tsx`).
 * Side-effect-free.
 */
export function findMuiTheme(appRoot: string): string | undefined {
  return findModule(
    appRoot,
    (src) => src.includes("@mui/") && callArgument(src, "createTheme") !== undefined,
  );
}
