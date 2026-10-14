import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const TW_CONFIG_NAMES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.cjs",
];

/**
 * The Tailwind config an app's stylesheet belongs to: the nearest one at or
 * above the stylesheet's directory (a `globals.css` usually sits a level or
 * two below it), as its path and source. Bounded; null when there is none — a
 * Tailwind 4 app keeps its theme in the stylesheet and has no such file.
 */
export function nearestTailwindConfigFile(
  stylesheetPath: string,
): { path: string; source: string } | null {
  let dir = dirname(stylesheetPath);
  for (let i = 0; i < 5; i++) {
    for (const name of TW_CONFIG_NAMES) {
      const path = join(dir, name);
      try {
        return { path, source: readFileSync(path, "utf8") };
      } catch {
        // Not here; try the next name, then the parent.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
