import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Best-effort Tailwind major version of an app root, from its package.json
 * dependency ranges. Prefers the explicit `tailwindcss` range; falls back to
 * the v4-only adapter packages, which imply v4 even when `tailwindcss` is
 * pinned transitively. Null when the app doesn't declare Tailwind at all.
 *
 * Lives in codegen (not the CLI) because the emit paths route on it: a v3
 * target gets the v3 theme artifacts, a v4 target gets `@theme` globals.css.
 */
export function detectTailwindMajor(appRoot: string): 3 | 4 | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  const deps: Record<string, unknown> = {
    ...((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
  };
  const range = deps.tailwindcss;
  if (typeof range === "string") {
    const m = range.match(/(\d+)/);
    if (m) return Number(m[1]) >= 4 ? 4 : 3;
  }
  if (
    typeof deps["@tailwindcss/vite"] === "string" ||
    typeof deps["@tailwindcss/postcss"] === "string"
  ) {
    return 4;
  }
  return null;
}
