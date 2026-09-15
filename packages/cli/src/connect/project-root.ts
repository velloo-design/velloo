import { existsSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, parse, relative, resolve } from "node:path";
import { managedProjectContext } from "@velloo/server";
import { type FoundManifest, findManifest } from "../manifest.ts";

/**
 * Where to write the agent config. An explicit override wins; then the
 * directory holding the `velloo.json` that registers the folder — the repo
 * root, which is where an agent is opened in a monorepo even when the design
 * targets `apps/web` — and otherwise the nearest `package.json` above the
 * design folder, falling back to its parent (a standalone design repo).
 */
export async function resolveProjectRoot(designFolder: string, override?: string): Promise<string> {
  if (override) return override;
  const managed = managedProjectContext(designFolder);
  if (managed) return dirname(managed.manifestPath);
  const registered = await registeringManifest(designFolder);
  if (registered) return registered.found.dir;
  return nearestPackageRoot(designFolder);
}

/**
 * How an agent config under `projectRoot` names the design folder. A project
 * name resolves through `velloo.json` from any cwd inside the repo, so it
 * survives the agent being opened in a subdirectory; a path only resolves
 * from `projectRoot` itself, so it is the fallback for unregistered folders.
 */
export async function designFolderReference(
  projectRoot: string,
  designFolder: string,
): Promise<string> {
  const managed = managedProjectContext(designFolder);
  if (managed) return managed.projectName;
  const registered = await registeringManifest(designFolder);
  if (registered && isUnder(registered.found.dir, resolve(projectRoot))) return registered.name;
  return relative(projectRoot, designFolder) || ".";
}

/**
 * Every root that may hold agent guidance for the folder: the current one, and
 * the `package.json` root older versions wired a monorepo app's folder into —
 * so an upgrade refreshes the skills an earlier init left there too.
 */
export async function agentRootCandidates(designFolder: string): Promise<string[]> {
  const roots = [await resolveProjectRoot(designFolder)];
  if (!managedProjectContext(designFolder)) roots.push(await nearestPackageRoot(designFolder));
  return [...new Set(roots)];
}

async function registeringManifest(
  designFolder: string,
): Promise<{ found: FoundManifest; name: string } | null> {
  const abs = resolve(designFolder);
  let found: FoundManifest | null;
  try {
    found = await findManifest(abs);
  } catch {
    // A broken manifest is reported by the commands that resolve through it.
    return null;
  }
  if (!found) return null;
  const real = existsSync(abs) ? realpathSync(abs) : abs;
  for (const [name, folder] of found.folders) {
    if (folder === abs || (existsSync(folder) && realpathSync(folder) === real))
      return { found, name };
  }
  return null;
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

function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !parse(rel).root);
}
