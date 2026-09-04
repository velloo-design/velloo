import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ColorPair,
  DEFAULT_TYPESET_NAME,
  resolveColors,
  resolveTypeset,
  type Theme,
  typesetScale,
} from "@velloo/schema";
import { parse } from "culori";
import { diffFile } from "../diff.ts";
import type { EmitThemeFile } from "./index.ts";

type DtcgToken = { $type: string; $value: unknown };
type DtcgGroup = { [name: string]: DtcgGroup | DtcgToken };

function colorValue(value: string): DtcgToken | null {
  const parsed = parse(value);
  if (!parsed) return null;
  const mode = parsed.mode;
  if (mode === "oklch") {
    return {
      $type: "color",
      $value: {
        colorSpace: "oklch",
        components: [parsed.l, parsed.c, parsed.h ?? "none"],
        alpha: parsed.alpha ?? 1,
      },
    };
  }
  if (mode === "rgb") {
    return {
      $type: "color",
      $value: {
        colorSpace: "srgb",
        components: [parsed.r, parsed.g, parsed.b],
        alpha: parsed.alpha ?? 1,
      },
    };
  }
  return null;
}

function colorPairTokens(
  value: ColorPair,
  warnings: string[],
  path: string,
): DtcgGroup | DtcgToken {
  if (typeof value === "string") return colorToken(value, warnings, path);
  return {
    DEFAULT: colorToken(value.DEFAULT, warnings, `${path}.DEFAULT`),
    ...(value.foreground
      ? { foreground: colorToken(value.foreground, warnings, `${path}.foreground`) }
      : {}),
  };
}

function colorToken(value: string, warnings: string[], path: string): DtcgToken {
  const token = colorValue(value);
  if (token) return token;
  warnings.push(
    `DTCG token ${path} uses an unsupported CSS color expression (${JSON.stringify(value)}); exported as a string so it is not silently altered.`,
  );
  return { $type: "string", $value: value };
}

function scalarToken(value: string | number): DtcgToken {
  return { $type: typeof value === "number" ? "number" : "string", $value: value };
}

function dimensionToken(value: string | number): DtcgToken {
  if (typeof value === "number") {
    return { $type: "dimension", $value: { value, unit: "px" } };
  }
  return { $type: "string", $value: value };
}

function looseGroup(
  group: Record<string, unknown>,
  tokenForScalar: (value: string | number) => DtcgToken = scalarToken,
): DtcgGroup {
  return Object.fromEntries(
    Object.entries(group).map(([name, value]) => [
      name,
      value !== null && typeof value === "object"
        ? looseGroup(value as Record<string, unknown>, tokenForScalar)
        : tokenForScalar(value as string | number),
    ]),
  );
}

/** The authored rhythm controls, per typeset. */
function typesetGroup(typesets: NonNullable<Theme["typography"]["typesets"]>): DtcgGroup {
  return Object.fromEntries(
    Object.entries(typesets).map(([name, typeset]) => {
      const resolved = resolveTypeset(typeset);
      return [
        name,
        {
          size: dimensionToken(resolved.size),
          leading: scalarToken(resolved.leading),
          flow: dimensionToken(resolved.flow),
        },
      ];
    }),
  );
}

/** The default typeset's ladder, resolved to concrete values. */
function scaleGroup(theme: Theme): DtcgGroup {
  const scale = typesetScale(theme.typography.typesets?.[DEFAULT_TYPESET_NAME], {
    ...(theme.typography.fontFamily ? { fontFamily: theme.typography.fontFamily } : {}),
  });
  return Object.fromEntries(
    Object.entries(scale).map(([role, resolved]) => [
      role,
      {
        fontSize: dimensionToken(resolved.fontSize),
        lineHeight: scalarToken(resolved.lineHeight),
        letterSpacing: { $type: "string", $value: resolved.letterSpacing },
        fontWeight: scalarToken(resolved.fontWeight),
        ...(resolved.fontFamily
          ? { fontFamily: { $type: "fontFamily", $value: resolved.fontFamily } }
          : {}),
      },
    ]),
  );
}

function colorGroup(
  colors: Theme["colors"] | NonNullable<Theme["colorsDark"]>,
  warnings: string[],
  mode: string,
): DtcgGroup {
  return Object.fromEntries(
    Object.entries(colors).map(([name, value]) => [
      name,
      colorPairTokens(value as ColorPair, warnings, `${mode}.color.${name}`),
    ]),
  );
}

function resolvedDarkColors(theme: Theme): Theme["colors"] {
  return resolveColors(theme, true);
}

function modeGroup(theme: Theme, dark: boolean, warnings: string[]): DtcgGroup {
  const palette = dark
    ? { ...(theme.palette ?? {}), ...(theme.paletteDark ?? {}) }
    : (theme.palette ?? {});
  return {
    color: {
      ...colorGroup(
        dark ? resolvedDarkColors(theme) : theme.colors,
        warnings,
        dark ? "dark" : "light",
      ),
      palette: Object.fromEntries(
        Object.entries(palette).map(([name, value]) => [
          name,
          colorToken(value, warnings, `${dark ? "dark" : "light"}.color.palette.${name}`),
        ]),
      ),
    },
    typography: {
      ...(theme.typography.fontFamily
        ? {
            fontFamily: looseGroup(theme.typography.fontFamily, (value) => ({
              $type: "fontFamily",
              $value: value,
            })),
          }
        : {}),
      ...(theme.typography.typesets ? { typeset: typesetGroup(theme.typography.typesets) } : {}),
      // The resolved ladder. A consuming design tool wants concrete values, not
      // the three controls it would have to re-derive — so export both: the
      // authored rhythm above, and what it computes to here.
      scale: scaleGroup(theme),
    },
    spacing: looseGroup(theme.spacing, dimensionToken),
    radius: looseGroup(theme.radius, dimensionToken),
    ...(theme.shadows ? { shadow: looseGroup(theme.shadows) } : {}),
  };
}

/** Serialize the portable subset of a Velloo theme as DTCG design tokens. */
export function emitDtcgTokens(theme: Theme): { contents: string; warnings: string[] } {
  const warnings: string[] = [];
  const document: DtcgGroup = {
    light: modeGroup(theme, false, warnings),
    ...(theme.colorsDark || theme.paletteDark ? { dark: modeGroup(theme, true, warnings) } : {}),
  };
  if (theme.keyframes || theme.animation || theme.container) {
    warnings.push(
      "DTCG tokens.json excludes container, animation, and keyframe configuration because those are framework behavior rather than portable design tokens; they remain in the framework-specific theme artifacts.",
    );
  }
  if (theme.typography.googleFonts?.length) {
    warnings.push(
      "DTCG tokens.json excludes Google Fonts loading declarations; font-family tokens are exported, while loading remains in the framework-specific theme artifact.",
    );
  }
  return { contents: `${JSON.stringify(document, null, 2)}\n`, warnings };
}

export async function emitDtcgFile(
  theme: Theme,
  options: { outputDir: string; apply?: boolean | undefined },
): Promise<{ file: EmitThemeFile; warnings: string[] }> {
  const { contents, warnings } = emitDtcgTokens(theme);
  const path = join(options.outputDir, "tokens.json");
  const diff = await diffFile(path, contents);
  let applied = false;
  if (options.apply && !diff.identical) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    applied = true;
  }
  return { file: { path, contents, diff, applied, errors: [] }, warnings };
}
