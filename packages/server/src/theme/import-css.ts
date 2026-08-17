import { parseThemeCss } from "@velloo/codegen";
import { err, ok, type Result } from "@velloo/result";
import { type ColorPair, type Theme, ThemeSchema } from "@velloo/schema";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { invalidThemePath, type ThemeError, themeBadRequest } from "./errors.ts";

export interface ThemeTokenChange {
  token: string;
  from: string | null;
  to: string;
}

export interface ImportThemeCssResult {
  theme: Theme;
  changes: ThemeTokenChange[];
  warnings: string[];
  applied: boolean;
}

function pairEntries(prefix: string, value: ColorPair): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  const out: Array<[string, string]> = [[`${prefix}.DEFAULT`, value.DEFAULT]];
  if (value.foreground !== undefined) out.push([`${prefix}.foreground`, value.foreground]);
  return out;
}

function tokenAt(theme: Theme, path: string): string | null {
  let cursor: unknown = theme;
  for (const seg of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return null;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  if (typeof cursor === "string") return cursor;
  if (typeof cursor === "number") return String(cursor);
  // A string slot replacing a { DEFAULT, foreground } pair (or vice versa)
  // still reports: surface the pair's DEFAULT as the old value.
  if (typeof cursor === "object" && cursor !== null && "DEFAULT" in cursor) {
    const d = (cursor as { DEFAULT?: unknown }).DEFAULT;
    return typeof d === "string" ? d : null;
  }
  return null;
}

/**
 * Code-to-design theme capture: merge tokens parsed from a host app's
 * stylesheet into a named theme. Slots the CSS doesn't declare keep their
 * current values, so a partial stylesheet never degrades a valid theme.
 * Dry-run by default — `apply: true` persists.
 */
export async function importThemeCss(
  folder: DesignFolder,
  css: string,
  opts: { themeName?: string; apply?: boolean } = {},
): Promise<Result<ImportThemeCssResult, ThemeError>> {
  const parsed = parseThemeCss(css);
  const foundAny =
    Object.keys(parsed.colors).length > 0 ||
    Object.keys(parsed.colorsDark).length > 0 ||
    parsed.radius !== undefined ||
    parsed.fontFamily !== undefined;
  if (!foundAny) {
    return err(
      themeBadRequest(
        "no recognizable theme tokens in the CSS — expected shadcn-convention custom properties (`--background`, `--primary`, …) in `:root`/`.dark`, or Tailwind v4 `--color-*` vars in `@theme`",
      ),
    );
  }

  const current = themeByName(folder, opts.themeName ?? "default");
  const next = JSON.parse(JSON.stringify(current)) as Theme;

  const changes: ThemeTokenChange[] = [];
  const record = (token: string, to: string): void => {
    const from = tokenAt(current, token);
    if (from !== to) changes.push({ token, from, to });
  };

  for (const [slot, value] of Object.entries(parsed.colors)) {
    if (value === undefined) continue;
    (next.colors as Record<string, ColorPair>)[slot] = value as ColorPair;
    for (const [token, to] of pairEntries(`colors.${slot}`, value as ColorPair)) {
      record(token, to);
    }
  }
  if (Object.keys(parsed.colorsDark).length > 0) {
    next.colorsDark = { ...(next.colorsDark ?? {}) };
    for (const [slot, value] of Object.entries(parsed.colorsDark)) {
      if (value === undefined) continue;
      (next.colorsDark as Record<string, ColorPair>)[slot] = value as ColorPair;
      for (const [token, to] of pairEntries(`colorsDark.${slot}`, value as ColorPair)) {
        record(token, to);
      }
    }
  }
  if (parsed.radius !== undefined) {
    next.radius = { ...next.radius, md: parsed.radius };
    record("radius.md", parsed.radius);
  }
  if (parsed.fontFamily !== undefined) {
    next.typography = {
      ...next.typography,
      fontFamily: { ...(next.typography.fontFamily ?? {}), ...parsed.fontFamily },
    };
    for (const [role, stack] of Object.entries(parsed.fontFamily)) {
      record(`typography.fontFamily.${role}`, stack);
    }
  }

  const validated = ThemeSchema.safeParse(next);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    return err(
      invalidThemePath(
        `imported tokens produced an invalid theme at "${issue?.path.join(".")}": ${issue?.message ?? "schema mismatch"}`,
      ),
    );
  }

  if (!opts.apply) {
    return ok({ theme: validated.data, changes, warnings: parsed.warnings, applied: false });
  }
  const persisted = await persistNamedTheme(folder, opts.themeName ?? "default", validated.data);
  return ok({ theme: persisted, changes, warnings: parsed.warnings, applied: true });
}
