import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Theme } from "@velloo/schema";
import { diffFile, type FileDiff } from "../diff.ts";
import { type FormatError, formatCss } from "../format.ts";
import { emitDtcgFile } from "./dtcg.ts";
import {
  emitGlobalsCss,
  emitTypesetCss,
  paletteShadowedSlots,
  TYPESET_CSS_FILENAME,
} from "./globals-css.ts";
import { emitTailwindConfig } from "./tailwind-config.ts";
import { emitThemeV3 } from "./v3.ts";

export interface EmitThemeOptions {
  /** Directory to write into (or diff against). e.g. ../my-app */
  outputDir: string;
  /**
   * Where globals.css lands, relative to `outputDir`. Defaults to the
   * Next.js convention `app/globals.css`. Vite/Astro hosts usually want
   * `globals.css` or `src/index.css` — pass it here rather than being
   * surprised by an `app/` segment.
   */
  cssPath?: string;
  /** Skip emitting tailwind.config.ts when true. Default false. */
  cssOnly?: boolean;
  /** Whether to actually write files. Default false → returns diffs only. */
  apply?: boolean;
  /**
   * `content` globs for the emitted tailwind.config.ts. Defaults to the
   * Next.js layout (app/, components/, pages/) — Vite/Astro hosts pass
   * the globs matching their structure.
   */
  contentGlobs?: readonly string[];
  /** Folder custom.css contents — appended verbatim to globals.css. */
  customCss?: string;
  /**
   * Target app's Tailwind major. `3` emits the v3 projection — a
   * `velloo-theme.css` (HSL-triplet vars next to the globals path, never the
   * globals file itself) plus a `velloo.preset.{ts,cjs}` the user's config
   * registers under `presets`. Default 4 (today's `@theme` globals.css).
   */
  tailwindMajor?: 3 | 4;
}

export interface EmitThemeFile {
  path: string;
  contents: string;
  diff: FileDiff;
  applied: boolean;
  errors: FormatError[];
}

export interface EmitThemeResult {
  files: EmitThemeFile[];
  /** Non-fatal notes about the emit — e.g. palette tokens shadowing semantic slots. */
  warnings: string[];
  /** Follow-up wiring the caller/agent must do by hand (v3 preset + @import lines). */
  notes: string[];
}

export async function emitTheme(theme: Theme, options: EmitThemeOptions): Promise<EmitThemeResult> {
  if (options.tailwindMajor === 3) return emitThemeV3(theme, options);
  const files: EmitThemeFile[] = [];
  const warnings: string[] = [];
  const shadowed = paletteShadowedSlots(theme);
  if (shadowed.length > 0) {
    warnings.push(
      `Skipped palette token${shadowed.length > 1 ? "s" : ""} ${shadowed.map((n) => `\`${n}\``).join(", ")}: ` +
        `each would emit a duplicate \`--color-<name>\` shadowing the semantic slot (the .dark override then repaints it — brand text like \`text-muted\` goes invisible on dark surfaces). ` +
        `Set the semantic slot itself (\`colors.<name>\` / \`colorsDark.<name>\`) or rename the palette token (e.g. \`brand-<name>\`).`,
    );
  }

  const cssPath = join(options.outputDir, options.cssPath ?? "app/globals.css");
  const cssRaw = emitGlobalsCss(theme, { customCss: options.customCss });
  // Biome's CSS parser doesn't recognize @theme; format errors are warnings.
  // Keep the raw if formatting fails — the output is still valid Tailwind v4.
  const cssFormatted = await formatCss(cssPath, cssRaw);
  const cssDiff = await diffFile(cssPath, cssFormatted.output);
  let cssApplied = false;
  if (options.apply && !cssDiff.identical) {
    await mkdir(dirname(cssPath), { recursive: true });
    await writeFile(cssPath, cssFormatted.output, "utf8");
    cssApplied = true;
  }
  files.push({
    path: cssPath,
    contents: cssFormatted.output,
    diff: cssDiff,
    applied: cssApplied,
    errors: cssFormatted.errors,
  });

  // The typeset sheet, a sibling of globals.css (which @imports it).
  const typesetPath = join(dirname(cssPath), TYPESET_CSS_FILENAME);
  const typesetRaw = emitTypesetCss(theme);
  const typesetFormatted = await formatCss(typesetPath, typesetRaw);
  const typesetDiff = await diffFile(typesetPath, typesetFormatted.output);
  let typesetApplied = false;
  if (options.apply && !typesetDiff.identical) {
    await mkdir(dirname(typesetPath), { recursive: true });
    await writeFile(typesetPath, typesetFormatted.output, "utf8");
    typesetApplied = true;
  }
  files.push({
    path: typesetPath,
    contents: typesetFormatted.output,
    diff: typesetDiff,
    applied: typesetApplied,
    errors: typesetFormatted.errors,
  });

  if (!options.cssOnly) {
    const tsPath = join(options.outputDir, "tailwind.config.ts");
    const tsRaw = emitTailwindConfig(options.contentGlobs);
    const tsDiff = await diffFile(tsPath, tsRaw);
    let tsApplied = false;
    if (options.apply && !tsDiff.identical) {
      await mkdir(dirname(tsPath), { recursive: true });
      await writeFile(tsPath, tsRaw, "utf8");
      tsApplied = true;
    }
    files.push({
      path: tsPath,
      contents: tsRaw,
      diff: tsDiff,
      applied: tsApplied,
      errors: [],
    });
  }

  const dtcg = await emitDtcgFile(theme, options);
  files.push(dtcg.file);
  warnings.push(...dtcg.warnings);

  return { files, warnings, notes: [] };
}
