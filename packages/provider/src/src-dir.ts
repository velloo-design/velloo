import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve a provider package's `src/` directory across the ways velloo runs:
 * a `VELLOO_*_SRC` env override, the bundled-CLI layout (`<here>/pkgs/<pkg>/src`),
 * or the dev layout (`<here>/../src`). Picks the first candidate that actually
 * contains `tailwind-entry.css`, falling back to the dev path. Shared by the
 * concrete providers (provider-none, provider-mui), which differ only in the
 * package name + env-var override.
 */
export function resolveProviderSrcDir(here: string, pkgName: string, envOverride?: string): string {
  const dev = join(here, "..", "src");
  const candidates = [envOverride, join(here, "pkgs", pkgName, "src"), dev].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((d) => existsSync(join(d, "tailwind-entry.css"))) ?? dev;
}
