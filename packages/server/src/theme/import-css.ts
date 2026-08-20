import {
  type ContainerConfig,
  paletteName,
  parseTailwindContainer,
  parseThemeCss,
  parseThemeExtend,
  resolveCssVars,
  type ThemeExtend,
} from "@velloo/codegen";
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
  opts: { themeName?: string; apply?: boolean; tailwindConfig?: string } = {},
): Promise<Result<ImportThemeCssResult, ThemeError>> {
  const parsed = parseThemeCss(css);
  // The host tailwind.config's theme.extend carries tokens that never reach the
  // stylesheet — brand colors, named shadows, font stacks defined in JS. Pull
  // them so "uses your real library" holds without manual re-registration.
  const extend: ThemeExtend | null = opts.tailwindConfig
    ? parseThemeExtend(opts.tailwindConfig)
    : null;
  const container: ContainerConfig | null = opts.tailwindConfig
    ? parseTailwindContainer(opts.tailwindConfig)
    : null;
  const foundAny =
    Object.keys(parsed.colors).length > 0 ||
    Object.keys(parsed.colorsDark).length > 0 ||
    Object.keys(parsed.palette).length > 0 ||
    Object.keys(parsed.paletteDark).length > 0 ||
    parsed.radius !== undefined ||
    parsed.fontFamily !== undefined ||
    extend !== null ||
    container !== null;
  if (!foundAny) {
    return err(
      themeBadRequest(
        "no recognizable theme tokens in the CSS — expected shadcn-convention custom properties (`--background`, `--primary`, …) in `:root`/`.dark`, or Tailwind v4 `--color-*` vars in `@theme`",
      ),
    );
  }

  const current = themeByName(folder, opts.themeName ?? "default");
  const next = JSON.parse(JSON.stringify(current)) as Theme;

  const warnings = [...parsed.warnings];
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
  if (Object.keys(parsed.palette).length > 0) {
    next.palette = { ...(next.palette ?? {}) };
    for (const [name, value] of Object.entries(parsed.palette)) {
      (next.palette as Record<string, string>)[name] = value;
      record(`palette.${name}`, value);
    }
  }
  if (Object.keys(parsed.paletteDark).length > 0) {
    next.paletteDark = { ...(next.paletteDark ?? {}) };
    for (const [name, value] of Object.entries(parsed.paletteDark)) {
      (next.paletteDark as Record<string, string>)[name] = value;
      record(`paletteDark.${name}`, value);
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

  // tailwind.config theme.extend → existing theme homes. CSS-derived values win
  // (they're the resolved tokens the app actually ships), so a name already set
  // from the stylesheet isn't overwritten by the config's literal.
  if (extend) {
    if (extend.colors) {
      next.palette = { ...(next.palette ?? {}) };
      for (const [name, value] of Object.entries(extend.colors)) {
        // A config color whose name collides with a semantic slot
        // (`primary`, `primary-foreground`, …) must NOT become a palette
        // passthrough — it would shadow the slot extractColors owns with an
        // unrelated value (often `hsl(var(--…))` pointing at a var that
        // doesn't exist in the canvas render context). paletteName drops
        // those (and any non-kebab key) the same way the stylesheet path does.
        if (paletteName(name) === null) continue;
        if (name in (next.palette as Record<string, string>)) continue;
        // Flatten `var(--x)` refs against the imported stylesheet's vars: the
        // config carries unresolved refs, but the canvas paints concrete
        // values. A ref we can't resolve here is dropped, not persisted dangling.
        const resolved = value.includes("var(") ? resolveCssVars(value, parsed.rootVars) : value;
        if (resolved === null || resolved === "") {
          warnings.push(
            `tailwind.config color "${name}" references a CSS var not declared in the imported stylesheet — skipped`,
          );
          continue;
        }
        (next.palette as Record<string, string>)[name] = resolved;
        record(`palette.${name}`, resolved);
      }
    }
    if (extend.spacing) {
      next.spacing = { ...next.spacing };
      for (const [name, value] of Object.entries(extend.spacing)) {
        if (name in (next.spacing as Record<string, string | number>)) continue;
        (next.spacing as Record<string, string>)[name] = value;
        record(`spacing.${name}`, value);
      }
    }
    if (extend.fontFamily) {
      const fontFamily = { ...(next.typography.fontFamily ?? {}) };
      for (const [role, stack] of Object.entries(extend.fontFamily)) {
        if (role in fontFamily) continue;
        fontFamily[role] = stack;
        record(`typography.fontFamily.${role}`, stack);
      }
      next.typography = { ...next.typography, fontFamily };
    }
    if (extend.boxShadow) {
      next.shadows = { ...(next.shadows ?? {}) } as Record<string, string>;
      for (const [name, value] of Object.entries(extend.boxShadow)) {
        (next.shadows as Record<string, string>)[name] = value;
        record(`shadows.${name}`, value);
      }
    }
    if (extend.keyframes) {
      next.keyframes = { ...(next.keyframes ?? {}), ...extend.keyframes };
      for (const [name, steps] of Object.entries(extend.keyframes)) {
        record(`keyframes.${name}`, Object.keys(steps).join(", "));
      }
    }
    if (extend.animation) {
      next.animation = { ...(next.animation ?? {}), ...extend.animation };
      for (const [name, value] of Object.entries(extend.animation)) {
        record(`animation.${name}`, value);
      }
    }
  }

  // Container: apply as a real theme concept (so `class="container"` matches the
  // app) instead of only reporting it as guidance.
  if (container) {
    next.container = { ...(next.container ?? {}), ...container };
    if (container.center !== undefined) record("container.center", String(container.center));
    if (container.padding !== undefined) record("container.padding", container.padding);
    if (container.maxWidth !== undefined) record("container.maxWidth", container.maxWidth);
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
    return ok({ theme: validated.data, changes, warnings, applied: false });
  }
  const persisted = await persistNamedTheme(folder, opts.themeName ?? "default", validated.data);
  return ok({ theme: persisted, changes, warnings, applied: true });
}
