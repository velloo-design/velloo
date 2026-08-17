import { err, type Result } from "@velloo/result";
import { type Theme, ThemeSchema } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import { invalidThemePath, type ThemeError } from "./errors.ts";

/**
 * Declare a font role. `role` is free-form — "sans" / "serif" / "mono"
 * are conventions, but "display" or "marquee" work the same way: each
 * role becomes a `--font-<role>` token, and Tailwind v4 derives a
 * `font-<role>` utility from it.
 */
export interface FontSpec {
  /** Token role, e.g. "display". Must be utility-name safe. */
  role: string;
  /** Family name as the CSS stack's first entry, e.g. "Unbounded". */
  family: string;
  /** Stack tail. Defaults to a sensible generic per common roles. */
  fallback?: string;
  /**
   * Google Fonts axis spec to load (the part after "family=<name>"),
   * e.g. "wght@400..900" or "ital,wght@0,300..900;1,300..900".
   * Pass `true` for a plain regular-weight load; omit for local/system
   * fonts that need no webfont.
   */
  google?: string | true;
}

const DEFAULT_FALLBACK: Record<string, string> = {
  serif: "ui-serif, Georgia, serif",
  mono: "ui-monospace, SFMono-Regular, monospace",
};

export async function setFonts(
  folder: DesignFolder,
  fonts: FontSpec[],
): Promise<Result<Theme, ThemeError>> {
  const fontFamily: Record<string, string> = { ...(folder.theme.typography.fontFamily ?? {}) };
  const googleFonts = [...(folder.theme.typography.googleFonts ?? [])];

  for (const spec of fonts) {
    if (!/^[a-z][a-z0-9-]*$/.test(spec.role)) {
      return err(
        invalidThemePath(
          `font role "${spec.role}" must be utility-name safe (lowercase letters, digits, dashes)`,
        ),
      );
    }
    const fallback =
      spec.fallback ?? DEFAULT_FALLBACK[spec.role] ?? "ui-sans-serif, system-ui, sans-serif";
    fontFamily[spec.role] = `"${spec.family}", ${fallback}`;

    if (spec.google) {
      const familyParam = spec.family.replace(/ /g, "+");
      const entry = spec.google === true ? familyParam : `${familyParam}:${spec.google}`;
      // One entry per family — a re-declare replaces the old axis spec.
      const existing = googleFonts.findIndex((g) => g.split(":")[0] === familyParam);
      if (existing === -1) googleFonts.push(entry);
      else googleFonts[existing] = entry;
    }
  }

  const next: Theme = {
    ...folder.theme,
    typography: { ...folder.theme.typography, fontFamily, googleFonts },
  };
  const parsed = ThemeSchema.safeParse(next);
  if (!parsed.success) {
    return err(invalidThemePath(parsed.error.issues[0]?.message ?? "invalid theme"));
  }
  const persisted = await persistTheme(folder, parsed.data);
  return { ok: true, value: persisted };
}
