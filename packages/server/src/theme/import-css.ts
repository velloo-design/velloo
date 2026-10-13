import {
  type ContainerConfig,
  importedRadius,
  paletteName,
  parseTailwindContainer,
  parseThemeCss,
  parseThemeExtend,
  resolveCssVars,
  type ThemeExtend,
  undefinedVar,
  unreadThemeExtend,
} from "@velloo/codegen";
import { err, ok, type Result } from "@velloo/result";
import { type ColorPair, ColorsSchema, type Theme, ThemeSchema } from "@velloo/schema";
import { catalogFont } from "@velloo/schema/fonts";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { invalidThemePath, type ThemeError, themeBadRequest } from "./errors.ts";
import type { FontLoader } from "./font-loaders.ts";
import {
  applyFonts,
  type FontSpec,
  familyParam,
  leadFamily,
  pruneGoogleFonts,
} from "./set-fonts.ts";

interface ThemeTokenChange {
  token: string;
  from: string | null;
  /** Null when the import removed the token rather than setting it. */
  to: string | null;
}

/**
 * What the import actually reached, split by the distinction that decides
 * whether a design will look like the app: a semantic slot themes the whole
 * canvas, a `palette.*` passthrough themes nothing until something references
 * it. An app whose custom properties don't follow the shadcn convention
 * (`--smtc-background-web-page-primary` and friends) maps zero semantic slots
 * while still producing hundreds of changes, and a bare change count reads as
 * success — so the split is reported, not left to be inferred.
 */
interface ImportThemeCoverage {
  /** Semantic color slots the stylesheet named, of `semanticTotal` available. */
  semantic: number;
  semanticTotal: number;
  /** Raw brand vars parked in `palette.*`; real, but they do not theme-flip. */
  palette: number;
  /** Semantic slots left on their previous values. */
  unmapped: string[];
}

/**
 * Something the app states that this import did not carry into the theme.
 * `changes` says what moved; without this list an import that skipped the
 * app's fonts and its dark palette reads exactly like one that had nothing
 * left to do.
 */
export interface NotImported {
  /** What was left out, as the app writes it. */
  what: string;
  reason: string;
}

/** A font the import found by following its variable to the loader that sets it. */
interface TracedFont {
  role: string;
  family: string;
  /** Host-relative file the loader call is in. */
  from: string;
}

export interface ImportThemeCssResult {
  theme: Theme;
  changes: ThemeTokenChange[];
  coverage: ImportThemeCoverage;
  /** Empty only when nothing the import saw was left behind. */
  notImported: NotImported[];
  /** Font roles set from a loader call rather than a stylesheet. */
  fonts: TracedFont[];
  warnings: string[];
  applied: boolean;
}

const UNSET_FONT_VAR = (cssVar: string): string =>
  `Its stack starts from ${cssVar}, which no imported stylesheet sets — a font loader sets it at runtime. Name the family with set_theme { fonts }.`;

const LOCAL_FONT = (cssVar: string, file: string): string =>
  `${cssVar} is set at runtime by next/font/local in ${file} — a font file in the repo, with no family name to load. Declare it in the theme's customCss (@font-face), or name the closest family with set_theme { fonts }.`;

export interface MergeThemeOptions {
  /** Source of the app's tailwind.config, when it has one. */
  tailwindConfig?: string | undefined;
  /**
   * Finds the loader call that sets a font custom property (`--font-sans`)
   * in the app. The merge does no I/O of its own; without this a font a
   * loader sets at runtime is reported, not imported.
   */
  fontLoader?: ((cssVar: string) => FontLoader | null) | undefined;
}

export type MergedTheme = Omit<ImportThemeCssResult, "applied">;

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
 * stylesheet into a theme. Slots the CSS doesn't declare keep their current
 * values, so a partial stylesheet never degrades a valid theme.
 *
 * Pure, and the one merge there is: `import_theme` runs it on a folder's
 * theme and `velloo init` on the theme it is about to scaffold, so a design
 * opens on what an agent's import would have given it.
 */
export function mergeThemeCss(
  current: Theme,
  css: string,
  opts: MergeThemeOptions = {},
): Result<MergedTheme, ThemeError> {
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
    parsed.radiusScale !== undefined ||
    parsed.shadows !== undefined ||
    parsed.fontFamily !== undefined ||
    extend !== null ||
    container !== null;
  if (!foundAny) {
    return err(
      themeBadRequest(
        "no theme tokens in this CSS. import_theme reads CSS custom properties: `--background` / `--primary`-style vars in `:root`/`.dark`, or Tailwind v4 `--color-*` vars in `@theme`. An app themed in JavaScript (a Mantine, MUI, Chakra or antd theme object handed to its provider) keeps none in a stylesheet, so there is nothing here to import: set Velloo's tokens with `set_theme`, and when the screen is built from the app's own components, give them the app's theme through the preview entry (`preview_status`, then `set_preview_entry`)",
      ),
    );
  }

  const next = JSON.parse(JSON.stringify(current)) as Theme;

  const warnings = [...parsed.warnings];
  const notImported: NotImported[] = [];
  const traced: (FontSpec & TracedFont)[] = [];
  /** A font role whose stack waits on a variable no stylesheet sets: follow it to its loader, or say so. */
  const traceFont = (role: string, cssVar: string, what: string): void => {
    const loader = opts.fontLoader?.(cssVar) ?? null;
    if (loader?.family) {
      traced.push({
        role,
        family: loader.family,
        google: loader.google ?? true,
        from: loader.file,
      });
      return;
    }
    notImported.push({
      what,
      reason: loader ? LOCAL_FONT(cssVar, loader.file) : UNSET_FONT_VAR(cssVar),
    });
  };
  for (const [role, cssVar] of Object.entries(parsed.unresolvedFonts ?? {})) {
    traceFont(role, cssVar, `--font-${role}`);
  }
  /** Roles whose stack this import wrote, from the stylesheet or the config. */
  const fontRoles = new Set(Object.keys(parsed.fontFamily ?? {}));
  const changes: ThemeTokenChange[] = [];
  const record = (token: string, to: string): void => {
    const from = tokenAt(current, token);
    if (from !== to) changes.push({ token, from, to });
  };
  // Counted as the merge runs rather than derived from `changes`: a slot the
  // stylesheet named that already held the same value IS mapped, and would be
  // invisible in a diff.
  const semanticSlots = new Set<string>();
  const paletteNames = new Set<string>();

  for (const [slot, value] of Object.entries(parsed.colors)) {
    if (value === undefined) continue;
    semanticSlots.add(slot);
    (next.colors as Record<string, ColorPair>)[slot] = value as ColorPair;
    for (const [token, to] of pairEntries(`colors.${slot}`, value as ColorPair)) {
      record(token, to);
    }
  }
  if (Object.keys(parsed.colorsDark).length > 0) {
    next.colorsDark = { ...(next.colorsDark ?? {}) };
    for (const [slot, value] of Object.entries(parsed.colorsDark)) {
      if (value === undefined) continue;
      semanticSlots.add(slot);
      (next.colorsDark as Record<string, ColorPair>)[slot] = value as ColorPair;
      for (const [token, to] of pairEntries(`colorsDark.${slot}`, value as ColorPair)) {
        record(token, to);
      }
    }
  }
  if (Object.keys(parsed.palette).length > 0) {
    next.palette = { ...(next.palette ?? {}) };
    for (const [name, value] of Object.entries(parsed.palette)) {
      paletteNames.add(name);
      (next.palette as Record<string, string>)[name] = value;
      record(`palette.${name}`, value);
    }
  }
  if (Object.keys(parsed.paletteDark).length > 0) {
    next.paletteDark = { ...(next.paletteDark ?? {}) };
    for (const [name, value] of Object.entries(parsed.paletteDark)) {
      paletteNames.add(name);
      (next.paletteDark as Record<string, string>)[name] = value;
      record(`paletteDark.${name}`, value);
    }
  }
  next.radius = importedRadius(current.radius, parsed);
  for (const [level, value] of Object.entries(next.radius)) {
    record(`radius.${level}`, String(value));
  }
  // A stated `--radius` replaces the scale, so the steps it displaced are part
  // of what this import did — unreported, a dry run would show one token moving
  // and hide that `rounded-lg` moves with it.
  for (const level of Object.keys(current.radius)) {
    if (level in next.radius) continue;
    changes.push({ token: `radius.${level}`, from: tokenAt(current, `radius.${level}`), to: null });
  }
  if (parsed.shadows !== undefined) {
    next.shadows = { ...(next.shadows ?? {}) } as Record<string, string>;
    for (const [name, value] of Object.entries(parsed.shadows)) {
      (next.shadows as Record<string, string>)[name] = value;
      record(`shadows.${name}`, value);
    }
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
        paletteNames.add(name);
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
        // The stylesheet's own `--font-<role>` won above, resolved or not: what
        // the theme held before the import is not a reason to keep it.
        if (parsed.fontFamily?.[role] !== undefined) continue;
        if (parsed.unresolvedFonts?.[role] !== undefined) continue;
        const resolved = stack.includes("var(") ? resolveCssVars(stack, parsed.rootVars) : stack;
        if (resolved === null || resolved === "") {
          const cssVar = undefinedVar(stack, parsed.rootVars) ?? "a custom property";
          traceFont(role, cssVar, `tailwind.config fontFamily.${role}`);
          continue;
        }
        fontFamily[role] = resolved;
        fontRoles.add(role);
        record(`typography.fontFamily.${role}`, resolved);
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

  // Fonts a loader names are declared the way `set_theme { fonts }` would,
  // family and weights. Then every family the import brought in that velloo's
  // catalogue knows gets its Google load: a stack alone renders as its
  // fallback on any machine without the face.
  if (traced.length > 0) {
    const declared = applyFonts(
      next,
      traced.map(({ role, family, google }) => ({ role, family, google })),
    );
    if (declared.ok) {
      next.typography = declared.value.typography;
      for (const { role } of traced) {
        record(`typography.fontFamily.${role}`, next.typography.fontFamily?.[role] ?? "");
      }
    } else {
      for (const { role, family, from } of traced.splice(0)) {
        notImported.push({
          what: `the ${role} font`,
          reason: `${family}, set by next/font in ${from}, could not be declared (${declared.error.kind}). Name it with set_theme { fonts }.`,
        });
      }
    }
  }
  if (traced.length > 0 || fontRoles.size > 0) {
    const stacks = next.typography.fontFamily ?? {};
    const loads = [...(next.typography.googleFonts ?? [])];
    for (const role of fontRoles) {
      const family = leadFamily(stacks[role] ?? "");
      const known = family ? catalogFont(family) : undefined;
      if (!family || !known) continue;
      const param = familyParam(family);
      if (loads.some((entry) => familyParam(entry.split(":")[0] ?? "") === param)) continue;
      loads.push(known.google === true ? param : `${param}:${known.google}`);
    }
    next.typography = { ...next.typography, googleFonts: pruneGoogleFonts(loads, stacks) };
  }

  // An app that names faces under its own roles (`--font-inter`) and applies
  // one by class has told the import what its fonts are, but not which of them
  // text is set in: `sans` — what everything renders in unless a node says
  // otherwise — stays whatever the theme had.
  const statedRoles = [
    ...new Set([
      ...Object.keys(parsed.fontFamily ?? {}),
      ...Object.keys(parsed.unresolvedFonts ?? {}),
      ...Object.keys(extend?.fontFamily ?? {}),
    ]),
  ];
  if (statedRoles.length > 0 && !statedRoles.includes("sans")) {
    const stacks = next.typography.fontFamily ?? {};
    const family = (stack: string | undefined): string =>
      (stack ?? "")
        .split(",")[0]
        ?.trim()
        .replace(/^["']|["']$/g, "") ?? "";
    const named = statedRoles.map((role) => family(stacks[role])).filter(Boolean);
    const body = stacks.sans;
    if (!named.some((name) => body?.includes(name))) {
      notImported.push({
        what: "a body font (`sans`)",
        reason: `The app names ${statedRoles.map((role) => `\`${role}\``).join(", ")} and no \`sans\`, the role text is set in unless a node says otherwise, so the theme's is ${body ? `still ${body}` : "unset"}. If one of the app's is its body face, give it that role: set_theme { fonts: [{ role: "sans", family: … }] }.`,
      });
    }
  }

  for (const { namespace, keys } of opts.tailwindConfig
    ? unreadThemeExtend(opts.tailwindConfig)
    : []) {
    notImported.push({
      what: `tailwind.config theme.extend.${namespace} (${keys.join(", ")})`,
      reason:
        "Not a theme token. The canvas compiles the app's own tailwind.config when that loads, so utilities built on it draw there, but it cannot be edited on the canvas and emit_theme does not write it.",
    });
  }
  if (!parsed.definesDark) {
    const kept = Object.keys(current.colorsDark ?? {}).length > 0;
    notImported.push({
      what: "a dark palette",
      reason: kept
        ? "The stylesheet has no dark block. `colorsDark` is left as it was, and is not the app's: on a fresh design it is the starter's. score_theme_contrast passing on it says nothing about the app."
        : "The stylesheet has no dark block, and the theme has no dark palette of its own.",
    });
  }

  const semanticTotal = Object.keys(ColorsSchema.shape).length;
  const coverage: ImportThemeCoverage = {
    semantic: semanticSlots.size,
    semanticTotal,
    palette: paletteNames.size,
    unmapped: Object.keys(ColorsSchema.shape).filter((slot) => !semanticSlots.has(slot)),
  };
  if (semanticSlots.size === 0 && paletteNames.size > 0) {
    warnings.push(
      `none of the ${semanticTotal} semantic color slots matched — all ${paletteNames.size} imported colors landed in \`palette.*\`, which does NOT theme the canvas. ` +
        `This app names its custom properties on its own convention rather than shadcn's (\`--background\`, \`--primary\`, …), so the design will still render on the previous palette. ` +
        `Map the slots yourself with set_theme { tokens: { "colors.background": "<a palette value>", … } }.`,
    );
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

  return ok({
    theme: validated.data,
    changes,
    coverage,
    notImported,
    fonts: traced.map(({ role, family, from }) => ({ role, family, from })),
    warnings,
  });
}

/** {@link mergeThemeCss} on a folder's named theme. Dry-run by default — `apply: true` persists. */
export async function importThemeCss(
  folder: DesignFolder,
  css: string,
  opts: MergeThemeOptions & { themeName?: string; apply?: boolean } = {},
): Promise<Result<ImportThemeCssResult, ThemeError>> {
  const name = opts.themeName ?? "default";
  const merged = mergeThemeCss(themeByName(folder, name), css, opts);
  if (!merged.ok) return merged;
  if (!opts.apply) return ok({ ...merged.value, applied: false });
  const persisted = await persistNamedTheme(folder, name, merged.value.theme);
  return ok({ ...merged.value, theme: persisted, applied: true });
}
