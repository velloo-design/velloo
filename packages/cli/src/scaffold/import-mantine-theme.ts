import { readFileSync } from "node:fs";
import { type Colors, type ColorsOverride, type Theme, ThemeSchema } from "@velloo/schema";
import { catalogFont } from "@velloo/schema/fonts";
import { applyFonts, findFontLoader, type NotImported } from "@velloo/server";
import { findModule } from "./find-module.ts";
import { withoutStarterFaces } from "./import-theme.ts";
import {
  MANTINE_COLORS,
  MANTINE_DEFAULT_RADIUS,
  MANTINE_PRIMARY_SHADE,
  MANTINE_RADIUS,
} from "./mantine-defaults.ts";
import {
  asCode,
  asNumber,
  asObject,
  asString,
  asStrings,
  callArgument,
  constLiteral,
  type LiteralObject,
  type LiteralValue,
  objectAfter,
  prop,
} from "./object-literal.ts";
import { buildPresetTheme } from "./theme-presets.ts";

interface ImportedMantineTheme {
  theme: Theme;
  /** Absent when the app sets no theme: the design is then on Mantine's own. */
  importedFrom?: string | undefined;
  /** Families the theme names, set on the design. */
  fonts: string[];
  /** What the theme states that this could not read. */
  notImported: NotImported[];
}

/** The theme a module declares: `createTheme({…})`, a typed override, or one inline on the provider. */
function themeLiteral(src: string): LiteralObject | undefined {
  return (
    callArgument(src, "createTheme") ??
    objectAfter(src, /:\s*MantineThemeOverride\s*=\s*/) ??
    objectAfter(src, /<MantineProvider\b[^>]*?\btheme=\{\s*/)
  );
}

/** The module a Mantine app's theme is in, wherever the app keeps it. Side-effect-free. */
export function findMantineTheme(appRoot: string): string | undefined {
  return findModule(appRoot, (src) => src.includes("@mantine/") && themeLiteral(src) !== undefined);
}

/** `#rgb` / `#rrggbb` as channels; anything else is not ours to mix. */
function channels(hex: string): number[] | undefined {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!digits) return undefined;
  const pairs = digits.length === 3 ? [...digits].map((d) => d + d) : (digits.match(/../g) ?? []);
  return pairs.map((pair) => Number.parseInt(pair, 16));
}

/**
 * `tint` at `alpha` over `surface`, as the opaque colour that paints. Mantine's
 * `light` variant is its filled colour at 10% (15% in dark) over whatever is
 * behind it; a velloo slot is one colour, so it is flattened onto the body.
 */
function over(tint: string, surface: string, alpha: number): string {
  const top = channels(tint);
  const bottom = channels(surface);
  if (!top || !bottom) return tint;
  const mixed = top.map((value, i) => Math.round(value * alpha + (bottom[i] ?? 0) * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** A font stack's families, quotes dropped. */
function families(stack: string): string[] {
  return stack
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter((family) => family !== "");
}

/** Families every machine has, or a generic: nothing to load. */
const SYSTEM_FAMILY =
  /^(?:-apple-system|BlinkMacSystemFont|system-ui|ui-[a-z-]+|sans-serif|serif|monospace|cursive|Segoe UI|Roboto|Helvetica(?: Neue)?|Arial|Verdana|Tahoma|Georgia|Times(?: New Roman)?|Courier(?: New)?|Menlo|Monaco|Consolas|SFMono-Regular|Liberation Mono)$/i;

const shadeIndex = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= 9 ? value : fallback;

/**
 * A Mantine app's theme as velloo tokens — the inverse of the Mantine recipe's
 * `themeToNative`, which hands the design's primary, body colours, radius and
 * fonts back to a `MantineProvider`. The slots Mantine has no name for are the
 * ones its components paint with all the same: borders are `gray.3`, dimmed
 * text `gray.6`, an error `red.6`.
 *
 * Reads inline literals only and never runs the app. What a theme computes
 * (`generateColors("#375EAC")`) is named in `notImported` and that slot keeps
 * `base`'s value; an app with no theme at all (`themeFile` undefined) is on
 * Mantine's defaults, and so is the design. Every Mantine app has a dark
 * scheme whether or not it shows it, so the design gets Mantine's and not
 * `base`'s. Returns null only when the result is not a valid theme.
 */
export function importThemeFromMantine(
  themeFile: string | undefined,
  appRoot: string,
  presetId?: string,
  base: Theme = withoutStarterFaces(buildPresetTheme(presetId, "default")),
): ImportedMantineTheme | null {
  let src = "";
  if (themeFile) {
    try {
      src = readFileSync(themeFile, "utf8");
    } catch {
      src = "";
    }
  }
  const root: LiteralObject = themeLiteral(src) ?? new Map();
  const notImported: NotImported[] = [];
  /** A name stands for the `const` that holds it, when that is a literal. */
  const follow = (value: LiteralValue | undefined): LiteralValue | undefined => {
    const code = asCode(value);
    return code ? constLiteral(src, code.text) : value;
  };

  const own = asObject(follow(prop(root, "colors")));
  const shadesOf = (name: string): readonly string[] | undefined => {
    const mine = own?.get(name);
    if (mine === undefined) return MANTINE_COLORS[name];
    const shades = asStrings(follow(mine));
    return shades && shades.length >= 10 ? shades : undefined;
  };
  const builtIn = (name: string): readonly string[] => shadesOf(name) ?? MANTINE_COLORS[name] ?? [];

  const primaryProp = prop(root, "primaryColor");
  const primaryName = primaryProp === undefined ? "blue" : asString(primaryProp);
  const primary = primaryName === undefined ? undefined : shadesOf(primaryName);
  if (!primary) {
    const written = asCode(primaryProp) ?? asCode(own?.get(primaryName ?? ""));
    notImported.push({
      what: `the primary colour (\`${written ? written.text.slice(0, 60) : primaryName}\`)`,
      reason:
        "Its shades are worked out in code, which init reads but does not run. Set `colors.primary` to the colour the app's filled buttons are.",
    });
  }

  const shade = prop(root, "primaryShade");
  const shadeFor = (scheme: "light" | "dark"): number =>
    shadeIndex(
      asNumber(shade) ?? asNumber(asObject(shade)?.get(scheme)),
      MANTINE_PRIMARY_SHADE[scheme],
    );
  const white = asString(prop(root, "white")) ?? "#fff";
  const black = asString(prop(root, "black")) ?? "#000";
  const gray = builtIn("gray");
  const red = builtIn("red");
  const dark = builtIn("dark");
  const at = (shades: readonly string[], index: number): string =>
    shades[index] ?? shades[shades.length - 1] ?? black;

  const colors: Colors = {
    ...base.colors,
    background: white,
    foreground: black,
    card: { DEFAULT: white, foreground: black },
    popover: { DEFAULT: white, foreground: black },
    muted: { DEFAULT: at(gray, 1), foreground: at(gray, 6) },
    accent: { DEFAULT: at(gray, 0), foreground: black },
    destructive: { DEFAULT: at(red, 6), foreground: white },
    border: at(gray, 3),
    input: at(gray, 4),
  };
  const colorsDark: ColorsOverride = {
    background: at(dark, 7),
    foreground: at(dark, 0),
    card: { DEFAULT: at(dark, 7), foreground: at(dark, 0) },
    popover: { DEFAULT: at(dark, 6), foreground: at(dark, 0) },
    muted: { DEFAULT: at(dark, 6), foreground: at(dark, 2) },
    accent: { DEFAULT: at(dark, 5), foreground: white },
    destructive: { DEFAULT: at(red, 8), foreground: white },
    border: at(dark, 4),
    input: at(dark, 4),
  };
  if (primary) {
    const filled = at(primary, shadeFor("light"));
    colors.primary = { DEFAULT: filled, foreground: white };
    colors.secondary = { DEFAULT: over(filled, white, 0.1), foreground: filled };
    colors.ring = filled;
    const filledDark = at(primary, shadeFor("dark"));
    colorsDark.primary = { DEFAULT: filledDark, foreground: white };
    colorsDark.secondary = {
      DEFAULT: over(at(primary, Math.max(0, shadeFor("dark") - 2)), at(dark, 7), 0.15),
      foreground: at(primary, Math.max(0, shadeFor("dark") - 5)),
    };
    colorsDark.ring = filledDark;
  }

  // The app's own colours, as the scale they are: `night.9` is `night-9`.
  const palette: Record<string, string> = { ...(base.palette ?? {}) };
  for (const [name, value] of own ?? []) {
    if (name in MANTINE_COLORS) continue;
    const key = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const shades = asStrings(follow(value));
    if (!shades || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key)) continue;
    shades.forEach((color, index) => {
      palette[`${key}-${index}`] = color;
    });
  }

  const scale = asObject(prop(root, "radius"));
  const named = (name: string): number | string | undefined =>
    asString(scale?.get(name)) ?? asNumber(scale?.get(name)) ?? MANTINE_RADIUS[name];
  const declared = prop(root, "defaultRadius") ?? MANTINE_DEFAULT_RADIUS;
  const radius =
    typeof declared === "number"
      ? declared
      : typeof declared === "string"
        ? (named(declared) ?? (/^\d/.test(declared) ? declared : undefined))
        : undefined;

  let theme: Theme = {
    ...base,
    colors,
    colorsDark,
    ...(Object.keys(palette).length > 0 ? { palette } : {}),
    radius: radius !== undefined ? { ...base.radius, md: radius } : base.radius,
  };

  // Mantine gives headings the body font unless the theme says otherwise.
  const body = prop(root, "fontFamily");
  const stacks: Array<[string, LiteralValue | undefined]> = [
    ["sans", body],
    ["display", asObject(prop(root, "headings"))?.get("fontFamily") ?? body],
    ["mono", prop(root, "fontFamilyMonospace")],
  ];
  /** The family a value names, and how the canvas can load it. */
  const fontOf = (
    value: LiteralValue,
  ): { family: string; stack?: string; fallback?: string; google?: string | true } | undefined => {
    const stack = asString(value);
    if (stack === undefined) {
      // `inter.style.fontFamily`, where `inter` is a `next/font/google` call in this module.
      const family = nextFontFamily(src, asCode(value)?.text);
      return family ? { family, google: true } : undefined;
    }
    const variable = /^var\(\s*(--[\w-]+)/.exec(stack)?.[1];
    if (variable) {
      const loader = findFontLoader(appRoot, variable);
      return loader?.family ? { family: loader.family, google: loader.google ?? true } : undefined;
    }
    const [family, ...rest] = families(stack);
    if (!family) return undefined;
    return { family, stack, ...(rest.length > 0 ? { fallback: rest.join(", ") } : {}) };
  };

  const fonts: string[] = [];
  const noted = new Set<string>();
  for (const [role, value] of stacks) {
    if (value === undefined) continue;
    const found = fontOf(value);
    if (!found) {
      const written = (asCode(value)?.text ?? asString(value) ?? "").slice(0, 60);
      if (!noted.has(written)) {
        notImported.push({
          what: `the font \`${written}\``,
          reason:
            "The theme takes it from code, which init reads but does not run. Find the family the app loads and `set_theme` it.",
        });
      }
      noted.add(written);
      continue;
    }
    if (found.stack && !catalogFont(found.family)) {
      // Named, and nothing here knows how to load it: the stack is still the app's.
      theme = {
        ...theme,
        typography: {
          ...theme.typography,
          fontFamily: { ...(theme.typography.fontFamily ?? {}), [role]: found.stack },
        },
      };
      if (!SYSTEM_FAMILY.test(found.family) && !fonts.includes(found.family)) {
        fonts.push(found.family);
        notImported.push({
          what: `how the app loads \`${found.family}\``,
          reason:
            "The theme names it, and it is neither a system font nor in velloo's catalogue, so the canvas shows the fallback until `set_theme` gives it a load (an `@font-face` stylesheet, or a Google axis spec).",
        });
      }
      continue;
    }
    const applied = applyFonts(theme, [
      {
        role,
        family: found.family,
        ...(found.fallback ? { fallback: found.fallback } : {}),
        ...(found.google ? { google: found.google } : {}),
      },
    ]);
    if (!applied.ok) continue;
    theme = applied.value;
    if (!fonts.includes(found.family)) fonts.push(found.family);
  }

  const parsed = ThemeSchema.safeParse(theme);
  if (!parsed.success) return null;
  return {
    theme: parsed.data,
    ...(themeFile && themeLiteral(src) ? { importedFrom: themeFile } : {}),
    fonts,
    notImported,
  };
}

function nextFontFamily(src: string, code: string | undefined): string | undefined {
  const local = /^([A-Za-z_$][\w$]*)\.style\.fontFamily$/.exec(code ?? "")?.[1];
  if (!local || !/from\s+["']next\/font\/google["']/.test(src)) return undefined;
  const loader = new RegExp(`\\bconst\\s+${local}\\s*=\\s*([A-Z][A-Za-z0-9_]*)\\s*\\(`).exec(src);
  return loader?.[1]?.replace(/_/g, " ");
}
