import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Theme } from "@velloo/schema";
import { diffFile, type FileDiff } from "../diff.ts";
import { type FormatError, formatCss } from "../format.ts";
import { emitGlobalsCss } from "./globals-css.ts";
import { emitTailwindConfig } from "./tailwind-config.ts";

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
}

export async function emitTheme(theme: Theme, options: EmitThemeOptions): Promise<EmitThemeResult> {
  const files: EmitThemeFile[] = [];

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

  return { files };
}
