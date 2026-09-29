import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve a provider package's `src/` directory across the ways velloo runs:
 * a `VELLOO_*_SRC` env override, the bundled-CLI layout (`<here>/pkgs/<pkg>/src`),
 * or the dev layout (`<here>/../src`). Picks the first candidate that actually
 * contains `marker` (the provider's Tailwind entry unless it ships another
 * asset), falling back to the dev path. Shared by the concrete providers, which
 * differ only in the package name, env-var override and marker file.
 */
export function resolveProviderSrcDir(
  here: string,
  pkgName: string,
  envOverride?: string,
  marker = "tailwind-entry.css",
): string {
  const dev = join(here, "..", "src");
  const candidates = [envOverride, join(here, "pkgs", pkgName, "src"), dev].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((d) => existsSync(join(d, marker))) ?? dev;
}
