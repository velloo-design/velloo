import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ColorPair,
  DEFAULT_TYPESET_NAME,
  resolveColors,
  resolveTypeset,
  type Theme,
  TYPESET_SCALE_NAMES,
  typesetScale,
} from "@velloo/schema";
import { diffFile } from "../diff.ts";
import { DESIGN_MD_SECTIONS, type DesignMdSection, designMdSection } from "./design-md-sections.ts";
import type { EmitThemeFile } from "./index.ts";

/**
 * Emit a Google Labs `DESIGN.md` (https://github.com/google-labs-code/design.md)
 * from a velloo theme.
 *
 * The format has a linter, a differ and an exporter but no generator, so every
 * DESIGN.md in the wild is hand-authored and nothing checks it against a
 * running product. Velloo emits from the tokens its screens actually render
 * with, which is the whole point of doing this at all.
 *
 * Colors go out in velloo's own vocabulary (`background`, `primary-foreground`,
 * `muted`), which the spec permits — it prescribes no color names — and which
 * the importer reads back directly rather than through its alias table. That is
 * what makes the round trip lossless for everything the format can hold.
 */

export interface EmitDesignMdOptions {
  outputDir: string;
  apply?: boolean | undefined;
  /**
   * The design system's name for the file's required `name:` field. Defaults
   * to `theme.name`, which is NOT it: that field is the named-theme key the
   * canvas edits through, so an import must not overwrite it with the
   * imported system's name. Callers pass the design folder's own name.
   */
  name?: string | undefined;
  /**
   * Which palette the file carries. DESIGN.md has no light/dark axis, so a
   * theme with `colorsDark` cannot round-trip through one file — `emitDesignMd`
   * is called once per mode and the dark one lands beside the light.
   */
  mode?: "light" | "dark" | undefined;
  /** Filename, relative to `outputDir`. Defaults to DESIGN.md / DESIGN.dark.md. */
  fileName?: string | undefined;
  /**
   * Authored prose per section, overriding the generated text. This is how a
   * folder's stored DESIGN.md body survives a round trip instead of being
   * replaced by a description of the tokens.
   */
  prose?: Partial<Record<DesignMdSection, string>> | undefined;
}

/**
 * YAML for the shapes this emitter produces: ordered maps, one level of
 * nesting, scalar leaves. Hand-rolled rather than pulled from a dependency
 * because the output is small, closed, and wants deterministic key order —
 * a diff against a previous emit should show token changes, not re-ordering.
 */
function yamlScalar(value: string | number): string {
  if (typeof value === "number") return String(value);
  // An allowlist, not a denylist. The values here include hex colors (`#` opens
  // a comment), dimensions (`1.5rem`), prose, and font stacks that START with a
  // quote — `"Inter", ui-sans-serif` parses as a quoted scalar followed by
  // garbage, which is exactly the finding the linter reported against a
  // denylist version of this function. Quoting is always safe; leaving a value
  // bare is the thing that needs justifying.
  const plainSafe = /^[A-Za-z][A-Za-z0-9 _-]*$/.test(value);
  const keyword = /^(true|false|null|yes|no|on|off|y|n)$/i.test(value);
  if (plainSafe && !keyword) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlMap(entries: Iterable<readonly [string, string | number]>, indent: string): string[] {
  const out: string[] = [];
  for (const [key, value] of entries) out.push(`${indent}${yamlScalar(key)}: ${yamlScalar(value)}`);
  return out;
}

/** `{ DEFAULT, foreground }` becomes `name` + `name-foreground`, shadcn-style. */
function colorEntries(slot: string, value: ColorPair): Array<[string, string]> {
  if (typeof value === "string") return [[slot, value]];
  const out: Array<[string, string]> = [[slot, value.DEFAULT]];
  if (value.foreground !== undefined) out.push([`${slot}-foreground`, value.foreground]);
  return out;
}

/** Velloo radius levels the spec's `rounded` has no quarrel with — all of them. */
function roundedEntries(theme: Theme): Array<[string, string]> {
  return Object.entries(theme.radius)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, typeof v === "number" ? `${v}px` : String(v)]);
}

/**
 * Spacing values the spec accepts: a `px`/`em`/`rem` dimension or a unitless
 * number. A velloo theme can hold `%` or `ch`, which the linter rejects.
 */
function spacingEntries(theme: Theme, warnings: string[]): Array<[string, string | number]> {
  const out: Array<[string, string | number]> = [];
  for (const [name, value] of Object.entries(theme.spacing)) {
    if (typeof value === "number") {
      out.push([name, value]);
      continue;
    }
    if (typeof value !== "string") continue;
    if (/^-?[\d.]+(px|em|rem)$/.test(value.trim())) out.push([name, value.trim()]);
    else warnings.push(`spacing.${name} ("${value}") is not a px/em/rem dimension — omitted.`);
  }
  return out;
}

function describeScale(entries: Array<[string, string | number]>): string {
  return entries.map(([k, v]) => `\`${k}\` ${v}`).join(", ");
}

export function emitDesignMdContents(
  theme: Theme,
  options: {
    mode?: "light" | "dark" | undefined;
    prose?: EmitDesignMdOptions["prose"];
    name?: string | undefined;
  } = {},
): { contents: string; warnings: string[]; omitted: string[] } {
  const warnings: string[] = [];
  const systemName = options.name?.trim() || theme.name;
  const dark = options.mode === "dark";
  const colors = resolveColors(theme, dark);
  const palette = (dark ? theme.paletteDark : theme.palette) ?? {};

  const colorRows: Array<[string, string]> = [];
  for (const [slot, value] of Object.entries(colors)) {
    if (value === undefined) continue;
    colorRows.push(...colorEntries(slot, value as ColorPair));
  }
  // The passthrough scale rides along so a DESIGN.md consumer sees the app's
  // own vocabulary too, not just the twelve semantic roles.
  for (const [name, value] of Object.entries(palette)) {
    if (!colorRows.some(([k]) => k === name)) colorRows.push([name, value]);
  }

  const typeset = resolveTypeset(theme.typography.typesets?.[DEFAULT_TYPESET_NAME]);
  const scale = typesetScale(theme.typography.typesets?.[DEFAULT_TYPESET_NAME], {
    ...(theme.typography.fontFamily ? { fontFamily: theme.typography.fontFamily } : {}),
  });

  const rounded = roundedEntries(theme);
  const spacing = spacingEntries(theme, warnings);

  const omitted: string[] = [];
  // Velloo styles nodes, not component tokens — there is no store to emit from,
  // and the spec's own `omitted` field exists for exactly this.
  omitted.push("components");
  if (rounded.length === 0) omitted.push("rounded");
  if (spacing.length === 0) omitted.push("spacing");

  const lines: string[] = ["---", "version: alpha", `name: ${yamlScalar(systemName)}`];
  lines.push(
    `description: ${yamlScalar(
      `Emitted by Velloo from the ${systemName} design folder${dark ? " (dark palette)" : ""}. ` +
        "These tokens are the ones its screens render with.",
    )}`,
  );
  lines.push("omitted:");
  for (const section of omitted) {
    const reason =
      section === "components"
        ? "Velloo styles nodes directly; it has no per-component token store."
        : "Not defined in this theme.";
    lines.push(`  - section: ${section}`, `    reason: ${yamlScalar(reason)}`);
  }

  lines.push("colors:", ...yamlMap(colorRows, "  "));

  lines.push("typography:");
  for (const role of TYPESET_SCALE_NAMES) {
    const r = scale[role];
    lines.push(`  ${role}:`);
    if (r.fontFamily) lines.push(`    fontFamily: ${yamlScalar(r.fontFamily)}`);
    lines.push(`    fontSize: ${r.fontSize}px`);
    lines.push(`    fontWeight: ${yamlScalar(String(r.fontWeight))}`);
    lines.push(`    lineHeight: ${r.lineHeight}`);
    if (r.letterSpacing !== "0em") lines.push(`    letterSpacing: ${r.letterSpacing}`);
  }

  if (rounded.length > 0) lines.push("rounded:", ...yamlMap(rounded, "  "));
  if (spacing.length > 0) lines.push("spacing:", ...yamlMap(spacing, "  "));
  lines.push("---", "");

  const generated: Record<DesignMdSection, string> = {
    Overview: `${systemName} is described here by its tokens rather than by intent: this file was emitted from a Velloo design folder, so every value below is one its screens actually render with. Replace this paragraph with the brand's own voice — that is the part a generator cannot supply.`,
    Colors: `The semantic roles are ${Object.keys(colors).join(", ")}. A role and its \`-foreground\` pair are meant to be used together: \`primary\` never appears without \`primary-foreground\` on top of it.${
      Object.keys(palette).length > 0
        ? ` Alongside them, ${Object.keys(palette).length} passthrough colors carry the product's own vocabulary; those are literal brand values and do not change between light and dark.`
        : ""
    }${
      theme.colorsDark && !dark
        ? " This file is the light palette; the dark one is a separate file, because DESIGN.md has no light/dark axis."
        : ""
    }`,
    Typography: `The ladder below is derived, not authored. Velloo stores three rhythm controls — base size ${typeset.size}, body leading ${typeset.leading}, block flow ${typeset.flow} — and computes h1..h6, lead, small and caption from them, so the proportions stay consistent when the rhythm is retuned. Treat the emitted sizes as the resolved output of those three numbers.`,
    Layout:
      spacing.length > 0
        ? `Spacing steps: ${describeScale(spacing)}.`
        : "No spacing scale is defined in this theme; layout uses the framework's defaults.",
    "Elevation & Depth": theme.shadows
      ? `Shadows: ${Object.keys(theme.shadows)
          .map((n) => `\`${n}\``)
          .join(
            ", ",
          )}. The spec has no token group for elevation, so these are described here rather than declared above.`
      : "This system does not use shadow elevation; depth comes from surface color steps instead.",
    Shapes:
      rounded.length > 0
        ? `Corner radii: ${describeScale(rounded)}.`
        : "No radius scale is defined in this theme.",
    Components:
      "Velloo styles component instances on the canvas rather than keeping a component token table, so the `components` block above is declared omitted. Compose from the library the folder targets and style through its own props and classes.",
    "Do's and Don'ts": `- Do use the semantic roles; they are what keeps a screen coherent when the palette changes.\n- Do retune the three typography controls rather than overriding sizes per element.\n- Don't hard-code a hex that already exists as a role.${
      theme.colorsDark
        ? "\n- Don't assume one palette: this system ships light and dark, and a literal color will not flip."
        : ""
    }`,
  };

  for (const section of DESIGN_MD_SECTIONS) {
    const body = designMdSection(options.prose, section) ?? generated[section];
    lines.push(`## ${section}`, "", body.trim(), "");
  }

  if (theme.keyframes || theme.animation || theme.container) {
    warnings.push(
      "container, animation and keyframe configuration have no DESIGN.md home — they stay in the framework theme artifacts (globals.css / tailwind.config).",
    );
  }
  if (theme.typography.googleFonts?.length) {
    warnings.push(
      "DESIGN.md carries font family names but no webfont loading; the Google Fonts declarations stay in the emitted globals.css.",
    );
  }

  return { contents: `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`, warnings, omitted };
}

export async function emitDesignMdFile(
  theme: Theme,
  options: EmitDesignMdOptions,
): Promise<{ file: EmitThemeFile; warnings: string[] }> {
  const dark = options.mode === "dark";
  const { contents, warnings } = emitDesignMdContents(theme, {
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.prose !== undefined ? { prose: options.prose } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
  });
  const path = join(options.outputDir, options.fileName ?? (dark ? "DESIGN.dark.md" : "DESIGN.md"));
  const diff = await diffFile(path, contents);
  let applied = false;
  if (options.apply && !diff.identical) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    applied = true;
  }
  return { file: { path, contents, diff, applied }, warnings };
}
