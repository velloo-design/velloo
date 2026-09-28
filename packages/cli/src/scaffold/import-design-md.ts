import { readFileSync } from "node:fs";
import type { Theme } from "@velloo/schema";
import { mapDesignMd } from "@velloo/server";
import type { ImportedTheme } from "./import-theme.ts";
import { buildPresetTheme } from "./theme-presets.ts";

export interface ImportedDesignMd extends ImportedTheme {
  /** The design system's own name, for telling the user what was found. */
  designSystem: string;
  /** Semantic color slots the file reached, of the twelve velloo has. */
  coverage: { semantic: number; semanticTotal: number };
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
  /** What the roles the file does not name keep — the app's stylesheet when it has one. */
  base?: Theme,
): ImportedDesignMd | null {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const mapped = mapDesignMd(base ?? buildPresetTheme(presetId, "default"), source);
  if (!mapped.ok) return null;
  const { theme, coverage, warnings, designSystem } = mapped.value;
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
    coverage: { semantic: coverage.semantic, semanticTotal: coverage.semanticTotal },
  };
}
