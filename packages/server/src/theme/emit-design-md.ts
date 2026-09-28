import { resolve } from "node:path";
import {
  designMdFileName,
  type EmitThemeFile,
  emitDesignMdFile,
  markdownSections,
} from "@velloo/codegen";
import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { designSystemDoc, readDesignSystemDoc } from "../design-system.ts";

export interface EmitDesignMdResult {
  files: EmitThemeFile[];
  warnings: string[];
  notes: string[];
}

/**
 * Emit a folder's theme as DESIGN.md — two files when it has a dark palette,
 * because the format has no light/dark axis and one file is one palette.
 *
 * The prose comes from the document the folder follows, read live, so an emit
 * carries authored intent rather than a description of the tokens. That same
 * document is never written: a target that resolves to it is diffed but left
 * alone, since the emit would drop its component tokens and per-token type.
 */
export async function emitDesignMdPair(
  folder: DesignFolder,
  theme: Theme,
  opts: { outputDir: string; apply: boolean },
): Promise<EmitDesignMdResult> {
  const source = await readDesignSystemDoc(folder);
  const prose = source === null ? undefined : markdownSections(source);
  const followed = designSystemDoc(folder)?.absolutePath;
  const files: EmitThemeFile[] = [];
  const warnings: string[] = [];
  const modes = theme.colorsDark ? (["light", "dark"] as const) : (["light"] as const);
  for (const mode of modes) {
    const target = resolve(opts.outputDir, designMdFileName(mode));
    const protectedTarget = followed !== undefined && target === resolve(followed);
    if (protectedTarget && opts.apply) {
      warnings.push(
        `${target} is the design system document this design follows, so it was not written — velloo reads that file and never writes it. Emit to another directory and merge by hand.`,
      );
    }
    const r = await emitDesignMdFile(theme, {
      outputDir: opts.outputDir,
      apply: opts.apply && !protectedTarget,
      mode,
      name: folder.config.name,
      ...(prose ? { prose } : {}),
    });
    files.push(r.file);
    warnings.push(...r.warnings);
  }
  return {
    files,
    warnings: [...new Set(warnings)],
    notes: [
      theme.colorsDark
        ? "Emitted two files: DESIGN.md is the light palette and DESIGN.dark.md the dark one. DESIGN.md has no light/dark axis, so a consumer reading only DESIGN.md sees the light palette."
        : "Emitted DESIGN.md. This theme has no dark palette, so one file carries all of it.",
      source === null
        ? "The prose sections are generated from the tokens. Point the design at a DESIGN.md (or write a guidance.md in the design folder) to supply real design intent instead."
        : "Prose sections were read from the design system document this design follows.",
    ],
  };
}
