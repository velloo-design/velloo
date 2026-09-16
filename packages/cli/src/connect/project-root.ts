import { existsSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, parse, relative, resolve } from "node:path";
import { type FoundRepoManifest, localDesignOf } from "@velloo/server";
import { findDesigns, findManifest } from "../manifest.ts";

/**
 * Where to write the agent config. An explicit override wins; then the
 * directory holding the `velloo.json` that registers the folder — the repo
 * root, which is where an agent is opened in a monorepo even when the design
 * targets `apps/web` — and otherwise the nearest `package.json` above the
 * design folder, falling back to its parent (a standalone design repo).
 */
export async function resolveProjectRoot(designFolder: string, override?: string): Promise<string> {
  if (override) return override;
  const local = localDesignOf(designFolder);
  if (local) return local.root;
  const registered = await registeringManifest(designFolder);
  if (registered) return registered.dir;
  return nearestPackageRoot(designFolder);
}

/**
 * The design argument an agent config under `projectRoot` has to carry, or
 * null when `velloo mcp` finds the design without one. A design the checkout
 * lists resolves from the agent's working directory — and a session can switch
 * designs — so pinning its name would only go stale on a rename or a move. A
 * folder the checkout doesn't list can only be named by its path.
 */
export async function designArgumentFor(
  projectRoot: string,
  designFolder: string,
): Promise<string | null> {
  const set = await findDesigns(projectRoot).catch(() => null);
  const target = realOr(designFolder);
  if (set?.designs.some((d) => !d.outsideRepo && realOr(d.root) === target)) return null;
  return relative(projectRoot, designFolder) || ".";
}

function realOr(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

/**
 * Every root that may hold agent guidance for the folder: the current one, and
 * the `package.json` root older versions wired a monorepo app's folder into —
 * so an upgrade refreshes the skills an earlier init left there too. None for
 * a local design, which never writes guidance into its checkout.
 */
export async function agentRootCandidates(designFolder: string): Promise<string[]> {
  if (localDesignOf(designFolder)) return [];
  const roots = [await resolveProjectRoot(designFolder)];
  roots.push(await nearestPackageRoot(designFolder));
  return [...new Set(roots)];
}

async function registeringManifest(designFolder: string): Promise<FoundRepoManifest | null> {
  const abs = resolve(designFolder);
  let found: FoundRepoManifest | null;
  try {
    found = await findManifest(abs);
  } catch {
    // A broken manifest is reported by the commands that resolve through it.
    return null;
  }
  if (!found) return null;
  const real = existsSync(abs) ? realpathSync(abs) : abs;
  const listed = found.folders.some(
    (folder) => folder === abs || (existsSync(folder) && realpathSync(folder) === real),
  );
  return listed ? found : null;
}

async function nearestPackageRoot(designFolder: string): Promise<string> {
  const fallback = dirname(designFolder);
  let dir = fallback;
  const fsRoot = parse(dir).root;
  for (let i = 0; i < 8; i++) {
    try {
      await access(join(dir, "package.json"));
      return dir;
    } catch {
      // No package.json here — keep walking up.
    }
    if (dir === fsRoot) break;
    dir = dirname(dir);
  }
  return fallback;
}
