import { err, type Result } from "@velloo/result";
import {
  DEFAULT_TYPESET_NAME,
  isTypesetName,
  type Theme,
  ThemeSchema,
  TYPESET_SCALE_NAMES,
  type Typeset,
} from "@velloo/schema";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { invalidThemePath, type ThemeError } from "./errors.ts";

/**
 * Declare or adjust a typeset — the three rhythm controls plus font roles that
 * the whole type ladder derives from.
 *
 * Fields are merged into the existing typeset, so tuning one control does not
 * require restating the others. Pass `null` for a field to clear it back to the
 * baseline.
 */
export interface TypesetSpec {
  /** Typeset name. `default` is the folder baseline that styles every screen. */
  name?: string;
  /** Base text size — `"1em"` follows the container, `16` / `"16px"` pins it. */
  size?: string | number | null;
  /** Body line-height, unitless. Heading leading derives from it. */
  leading?: number | null;
  /** Vertical space between blocks. Heading margins derive from it. */
  flow?: string | number | null;
  /** A `fontFamily` role name for body copy, e.g. "sans". */
  fontBody?: string | null;
  /** A `fontFamily` role name for headings, e.g. "display". */
  fontHeading?: string | null;
  /** A `fontFamily` role name for code. */
  fontMono?: string | null;
}

/** Field names on a typeset that name a font role, for validation messages. */
const FACE_FIELDS = ["fontBody", "fontHeading", "fontMono"] as const;

/** Apply one spec's non-undefined fields, treating null as "clear". */
function merge(current: Typeset, spec: TypesetSpec): Typeset {
  const next: Typeset = { ...current };
  if (spec.size !== undefined) {
    if (spec.size === null) delete next.size;
    else next.size = spec.size;
  }
  if (spec.leading !== undefined) {
    if (spec.leading === null) delete next.leading;
    else next.leading = spec.leading;
  }
  if (spec.flow !== undefined) {
    if (spec.flow === null) delete next.flow;
    else next.flow = spec.flow;
  }
  for (const field of FACE_FIELDS) {
    const value = spec[field];
    if (value === undefined) continue;
    if (value === null) delete next[field];
    else next[field] = value;
  }
  return next;
}

export async function setTypeset(
  folder: DesignFolder,
  typesets: TypesetSpec[],
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  const base = themeByName(folder, themeName);
  const declaredFaces = base.typography.fontFamily ?? {};
  const next: Record<string, Typeset> = { ...(base.typography.typesets ?? {}) };

  for (const spec of typesets) {
    const name = spec.name ?? DEFAULT_TYPESET_NAME;
    if (!isTypesetName(name)) {
      return err(
        invalidThemePath(
          `typeset name "${name}" must be selector-safe (letters, digits, dash, underscore) — it is emitted as a \`.typeset-${name}\` class`,
        ),
      );
    }
    if (spec.leading !== undefined && spec.leading !== null && spec.leading <= 0) {
      return err(invalidThemePath(`typeset "${name}": leading must be a positive number`));
    }
    for (const field of FACE_FIELDS) {
      const role = spec[field];
      if (role === undefined || role === null) continue;
      if (!(role in declaredFaces)) {
        const known = Object.keys(declaredFaces).sort().join(", ") || "none declared";
        return err(
          invalidThemePath(
            `typeset "${name}": ${field} "${role}" is not a declared font role (have: ${known}). Declare it with set_fonts first.`,
          ),
        );
      }
      // A role named after a scale entry would make `font-<role>` ambiguous with
      // the ladder's own utilities.
      if ((TYPESET_SCALE_NAMES as readonly string[]).includes(role)) {
        return err(
          invalidThemePath(
            `typeset "${name}": font role "${role}" collides with the type scale — rename the role (it would make \`font-${role}\` ambiguous)`,
          ),
        );
      }
    }
    next[name] = merge(next[name] ?? {}, spec);
  }

  const candidate: Theme = {
    ...base,
    typography: { ...base.typography, typesets: next },
  };
  const parsed = ThemeSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(invalidThemePath(parsed.error.issues[0]?.message ?? "invalid theme"));
  }
  const persisted = await persistNamedTheme(folder, themeName, parsed.data);
  return { ok: true, value: persisted };
}
