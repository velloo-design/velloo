import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Colors, Theme } from "@velloo/schema";
import { type Expression, type ObjectLiteralExpression, Project, SyntaxKind } from "ts-morph";
import type { ImportedTheme } from "./import-theme.ts";
import { buildPresetTheme } from "./theme-presets.ts";

/** The value expression of `name` on an object literal, or undefined. */
function prop(obj: ObjectLiteralExpression, name: string): Expression | undefined {
  const p = obj.getProperty(name);
  return p?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
}

function asObject(expr: Expression | undefined): ObjectLiteralExpression | undefined {
  return expr?.asKind(SyntaxKind.ObjectLiteralExpression);
}

/** A string literal value (`"#1976d2"`, `'Inter'`), unquoted. */
function asString(expr: Expression | undefined): string | undefined {
  return (
    expr?.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ??
    expr?.asKind(SyntaxKind.NoSubstitutionTemplateLiteral)?.getLiteralText()
  );
}

function asNumber(expr: Expression | undefined): number | undefined {
  const lit = expr?.asKind(SyntaxKind.NumericLiteral)?.getLiteralText();
  return lit !== undefined ? Number(lit) : undefined;
}

/** Find the `createTheme(...)` call's first argument object literal, if any. */
function createThemeArg(src: string): ObjectLiteralExpression | undefined {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("theme.ts", src);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    // Matches `createTheme(...)` and `xxx.createTheme(...)`.
    if (/(^|\.)createTheme$/.test(call.getExpression().getText())) {
      return call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
    }
  }
  return undefined;
}

/**
 * Read a MUI theme module — a `createTheme({ palette, shape, typography })`
 * call — and project its `ThemeOptions` back onto velloo's token tree (the
 * inverse of provider-mui's `muiThemeOptions`). Best-effort + side-effect-free:
 * only inline string/number literals are read, and an unparseable or
 * non-literal theme returns null so the caller falls back to the preset.
 *
 * The "existing project" flow's theme import for MUI apps (* docs/framework-native.md), the counterpart to `importThemeFromGlobals`.
 */
export function importThemeFromMui(filePath: string, presetId?: string): ImportedTheme | null {
  let src: string;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const root = createThemeArg(src);
  if (!root) return null;
  const palette = asObject(prop(root, "palette"));

  const colors: Partial<Colors> = {};
  const warnings: string[] = [];
  let tokenCount = 0;

  if (palette) {
    const pairOf = (key: string): { main?: string; contrastText?: string } => {
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

  const base = buildPresetTheme(presetId, "default");
  const theme: Theme = {
    ...base,
    colors: { ...base.colors, ...colors },
    radius: borderRadius !== undefined ? { ...base.radius, md: borderRadius } : base.radius,
    typography: fontFamily
      ? { ...base.typography, fontFamily: { ...base.typography.fontFamily, sans: fontFamily } }
      : base.typography,
  };

  return { theme, importedFrom: filePath, tokenCount, warnings };
}

/**
 * Best-effort location of a MUI theme module under the app root (no canonical
 * path). Checks the common spots; returns undefined if none contains a
 * `createTheme(` call. Side-effect-free.
 */
export function findMuiTheme(appRoot: string): string | undefined {
  const candidates = [
    "src/theme.ts",
    "src/theme.tsx",
    "src/theme/index.ts",
    "src/theme/index.tsx",
    "theme.ts",
    "src/styles/theme.ts",
    "src/lib/theme.ts",
    "app/theme.ts",
    "src/app/theme.ts",
  ];
  for (const rel of candidates) {
    const abs = join(appRoot, rel);
    if (!existsSync(abs)) continue;
    try {
      if (readFileSync(abs, "utf8").includes("createTheme(")) return abs;
    } catch {
      // unreadable — keep looking
    }
  }
  return undefined;
}
