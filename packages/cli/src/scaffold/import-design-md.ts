import { readFileSync } from "node:fs";
import { mapDesignMd } from "@velloo/server";
import type { ImportedTheme } from "./import-theme.ts";
import { buildPresetTheme } from "./theme-presets.ts";

export interface ImportedDesignMd extends ImportedTheme {
  /** The design system's own name, for telling the user what was found. */
  designSystem: string;
  /** Semantic color slots the file reached, of the twelve velloo has. */
  semantic: number;
  semanticTotal: number;
  /** The markdown body, to be written as the folder's `guidance.md`. */
  guidance: string;
}

/**
 * Seed a scaffold's theme from a repo's `DESIGN.md`.
 *
 * Preferred over parsing globals.css when a repo ships one: it is a design
 * system its authors wrote down on purpose, and it carries the prose half that
 * no stylesheet has. Returns null when the file is unreadable or maps nothing,
 * so the caller falls back to the stylesheet or the preset.
 */
export function importThemeFromDesignMd(
  filePath: string,
  presetId?: string,
): ImportedDesignMd | null {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const base = buildPresetTheme(presetId, "default");
  const mapped = mapDesignMd(base, source);
  if (!mapped.ok) return null;
  const { theme, coverage, warnings, designSystem, body } = mapped.value;
  // A file that reached no semantic slot has given us colors but none of the
  // roles that paint a screen — the preset is the better starting point, and
  // the user can still run import_theme later and read the coverage report.
  if (coverage.semantic === 0) return null;
  return {
    theme,
    importedFrom: filePath,
    tokenCount: coverage.semantic + coverage.palette,
    warnings,
    designSystem,
    semantic: coverage.semantic,
    semanticTotal: coverage.semanticTotal,
    guidance: body,
  };
}
