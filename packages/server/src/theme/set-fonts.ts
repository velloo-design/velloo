import { err, type Result } from "@velloo/result";
import { type Theme, ThemeSchema } from "@velloo/schema";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
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
  family?: string | undefined;
  /** Stack tail. Defaults to a sensible generic per common roles. */
  fallback?: string | undefined;
  /**
   * Google Fonts axis spec to load (the part after "family=<name>"),
   * e.g. "wght@400..900" or "ital,wght@0,300..900;1,300..900".
   * Pass `true` for a plain regular-weight load; omit for local/system
   * fonts that need no webfont.
   */
  google?: string | true | undefined;
  /**
   * Drop this role. Refused while a typeset still names it, because the
   * dangling reference would resolve to an undefined var and quietly fall back
   * to whatever the browser inherits.
   */
  remove?: boolean | undefined;
}

const DEFAULT_FALLBACK: Record<string, string> = {
  serif: "ui-serif, Georgia, serif",
  mono: "ui-monospace, SFMono-Regular, monospace",
};

/** css2 writes spaces as `+`; normalize so one family is one entry. */
function familyParam(family: string): string {
  return family.trim().replace(/ +/g, "+");
}

/** The family a stack leads with — `"Fraunces", ui-serif, …` → `Fraunces`. */
function leadFamily(stack: string): string | undefined {
  return /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(stack)?.slice(1).find(Boolean)?.trim();
}

/** Typeset faces pointing at a font role. */
const FACE_FIELDS = ["fontBody", "fontHeading", "fontMono"] as const;

/** Which typesets name this role, so a refusal can say where to look first. */
function typesetsUsing(theme: Theme, role: string): string[] {
  return Object.entries(theme.typography.typesets ?? {})
    .filter(([, typeset]) => FACE_FIELDS.some((field) => typeset[field] === role))
    .map(([name]) => name);
}

/**
 * Drop webfont loads no declared role leads with any more.
 *
 * Without this, reassigning a role leaves the family it used to point at in
 * `googleFonts` forever: every render keeps fetching a face nothing renders.
 * A picker makes reassignment cheap, so the leak would be continuous.
 */
function pruneGoogleFonts(entries: string[], fontFamily: Record<string, string>): string[] {
  const declared = new Set(
    Object.values(fontFamily)
      .map(leadFamily)
      .filter((f): f is string => f !== undefined)
      .map(familyParam),
  );
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const family = familyParam(entry.split(":")[0] ?? "");
    if (!declared.has(family) || seen.has(family)) return false;
    seen.add(family);
    return true;
  });
}

export async function setFonts(
  folder: DesignFolder,
  fonts: FontSpec[],
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  const base = themeByName(folder, themeName);
  const fontFamily: Record<string, string> = { ...(base.typography.fontFamily ?? {}) };
  const googleFonts = [...(base.typography.googleFonts ?? [])];

  for (const spec of fonts) {
    if (!/^[a-z][a-z0-9-]*$/.test(spec.role)) {
      return err(
        invalidThemePath(
          `font role "${spec.role}" must be utility-name safe (lowercase letters, digits, dashes)`,
        ),
      );
    }

    if (spec.remove) {
      if (!(spec.role in fontFamily)) {
        return err(
          invalidThemePath(`font role "${spec.role}" does not exist, so it cannot be removed`),
        );
      }
      const used = typesetsUsing(base, spec.role);
      if (used.length > 0) {
        return err(
          invalidThemePath(
            `font role "${spec.role}" is still used by the ${used.join(", ")} typeset${
              used.length > 1 ? "s" : ""
            } — point ${used.length > 1 ? "those faces" : "that face"} elsewhere first`,
          ),
        );
      }
      delete fontFamily[spec.role];
      continue;
    }

    if (!spec.family) {
      return err(invalidThemePath(`font role "${spec.role}": family is required`));
    }
    const fallback =
      spec.fallback ?? DEFAULT_FALLBACK[spec.role] ?? "ui-sans-serif, system-ui, sans-serif";
    fontFamily[spec.role] = `"${spec.family}", ${fallback}`;

    if (spec.google) {
      const param = familyParam(spec.family);
      const entry = spec.google === true ? param : `${param}:${spec.google}`;
      // One entry per family — a re-declare replaces the old axis spec.
      const existing = googleFonts.findIndex((g) => familyParam(g.split(":")[0] ?? "") === param);
      if (existing === -1) googleFonts.push(entry);
      else googleFonts[existing] = entry;
    }
  }

  const next: Theme = {
    ...base,
    typography: {
      ...base.typography,
      fontFamily,
      googleFonts: pruneGoogleFonts(googleFonts, fontFamily),
    },
  };
  const parsed = ThemeSchema.safeParse(next);
  if (!parsed.success) {
    return err(invalidThemePath(parsed.error.issues[0]?.message ?? "invalid theme"));
  }
  const persisted = await persistNamedTheme(folder, themeName, parsed.data);
  return { ok: true, value: persisted };
}
