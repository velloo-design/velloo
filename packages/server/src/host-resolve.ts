import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Module resolution that answers only for what the host app has.
 *
 * Bun's resolver does not stop at "not installed". From a directory with no
 * `node_modules` at or above it — a static site, a Flask app, a clone nobody
 * has installed yet — it switches to auto-install: a bare specifier resolves
 * out of Bun's global install cache, and one the cache lacks is downloaded from
 * npm first. Velloo asks the resolver whether an app has a package, so every
 * app with no dependencies at all "had" Mantine, got its stylesheet in every
 * render, and paid for the answer with a download.
 *
 * The CLI starts Bun with auto-install off (`BUN_RUNTIME_FLAGS`). These hold
 * for a process started some other way.
 */

/** Whether Node-style resolution from `dir` has a `node_modules` to look in. */
function reachesNodeModules(dir: string): boolean {
  for (let at = dir; ; ) {
    if (existsSync(join(at, "node_modules"))) return true;
    const parent = dirname(at);
    if (parent === at) return false;
    at = parent;
  }
}

/** A package directory of Bun's install cache: `<name>@<version>@@@<n>`. */
const INSTALL_CACHE_ENTRY = /@@@\d+(?:[\\/]|$)/;

/**
 * `Bun.resolveSync`, refusing an answer that came out of Bun's install cache
 * instead of the app. Throws as `Bun.resolveSync` does.
 *
 * For a specifier of any kind — a tsconfig alias resolves with no
 * `node_modules` anywhere, so the resolver still has to be asked.
 */
export function resolveInHost(specifier: string, from: string): string {
  const resolved = Bun.resolveSync(specifier, from);
  if (
    !specifier.startsWith(".") &&
    !isAbsolute(specifier) &&
    INSTALL_CACHE_ENTRY.test(resolved) &&
    // A symlinking install links `node_modules/<pkg>` into the cache, and that
    // is the app's own copy. Auto-install only answers when there is none.
    !reachesNodeModules(from)
  ) {
    throw new Error(`Cannot find module '${specifier}' from '${from}'`);
  }
  return resolved;
}

/**
 * Where a package the host app has installed resolves, or null when it has no
 * such package. For a specifier known to name a package: with no
 * `node_modules` to find it in there is nothing to ask, and asking is what
 * makes Bun download it.
 */
export function resolveHostPackage(specifier: string, hostRoot: string): string | null {
  if (!reachesNodeModules(hostRoot)) return null;
  try {
    return Bun.resolveSync(specifier, hostRoot);
  } catch {
    return null;
  }
}
