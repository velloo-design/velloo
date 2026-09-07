import type { Dirent } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { type RepoManifest, RepoManifestSchema } from "@velloo/schema";

/**
 * The repo-root manifest (`velloo.json`) names a repo's design folders so a
 * monorepo can hold several and commands can resolve them deterministically.
 * It is a pure pointer file — design settings stay in each folder's
 * `.design/config.json`; nothing here duplicates that contract.
 */
const MANIFEST_FILE = "velloo.json";

/** The conventional design-folder name, when a repo has no manifest yet. */
const DEFAULT_FOLDER_NAME = "velloo";

const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * The manifest shape lives in `@velloo/schema` because the daemon reads it
 * too — feedback consent is a repo preference, so both halves of velloo have
 * to agree on the file. Re-exported here so the CLI's callers don't need to
 * know that.
 */
const ManifestSchema = RepoManifestSchema;

type Manifest = RepoManifest;

export interface FoundManifest {
  /** Absolute path of the velloo.json file. */
  path: string;
  /** Directory holding it — project paths resolve against this. */
  dir: string;
  manifest: Manifest;
  /** Project name → absolute design-folder path. */
  folders: Map<string, string>;
}

/**
 * Walk up from `startDir` for a `velloo.json`. A missing file keeps walking;
 * a present-but-broken one throws with the path — a typo'd manifest silently
 * falling back to convention would resolve the wrong folder.
 */
export async function findManifest(startDir: string): Promise<FoundManifest | null> {
  let dir = resolve(startDir);
  while (true) {
    const path = join(dir, MANIFEST_FILE);
    let raw: string | null = null;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
      }
      const result = ManifestSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new Error(`${path} is not a valid velloo manifest: ${issues}`);
      }
      const folders = new Map(
        Object.entries(result.data.projects).map(([name, rel]) => [name, resolve(dir, rel)]),
      );
      return { path, dir, manifest: result.data, folders };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Pick the project `cwd` implies, or null when only a human (or
 * defaultProject) can disambiguate. Containment beats everything: standing
 * inside a project's folder — or inside a directory that holds exactly one
 * project (an app dir in a monorepo) — is an unambiguous choice.
 */
export function pickProject(found: FoundManifest, cwd: string): string | null {
  const entries = [...found.folders];
  const containing = entries.find(([, folder]) => cwd === folder || cwd.startsWith(folder + sep));
  if (containing) return containing[0];
  const under = entries.filter(([, folder]) => folder.startsWith(cwd + sep));
  if (under.length === 1 && under[0]) return under[0][0];
  if (entries.length === 1 && entries[0]) return entries[0][0];
  return found.manifest.defaultProject ?? null;
}

/**
 * Describe a design folder in manifest terms for display: when an
 * enclosing `velloo.json` registers it, "name — rel/path (in /repo/root)";
 * null otherwise (callers fall back to the raw path). Display-only, so a
 * broken manifest degrades to the fallback instead of failing the caller.
 */
export async function projectLabel(folder: string): Promise<string | null> {
  const abs = resolve(folder);
  let found: FoundManifest | null;
  try {
    found = await findManifest(abs);
  } catch {
    return null;
  }
  if (!found) return null;
  const entry = [...found.folders].find(([, path]) => path === abs);
  if (!entry) return null;
  const rel = relative(found.dir, abs) || ".";
  return `${entry[0]} — ${rel} (in ${found.dir})`;
}

export interface UnregisterResult {
  /** Project name that was removed, or null when the folder wasn't registered. */
  name: string | null;
  /** Manifest path, when there was one. */
  path: string | null;
  /** True when the manifest went away entirely (its last project left). */
  removedManifest: boolean;
}

/**
 * Drop a design folder from the repo manifest. When its last project goes the
 * file goes with it: a manifest with no projects shadows the `./velloo`
 * convention while naming nothing, which is worse than having no manifest.
 */
export async function unregisterProject(
  folder: string,
  appRoot: string,
): Promise<UnregisterResult> {
  const abs = resolve(folder);
  const found = await findManifest(appRoot);
  if (!found) return { name: null, path: null, removedManifest: false };
  let name: string | null = null;
  for (const [candidate, target] of found.folders) {
    if (target === abs) name = candidate;
  }
  if (!name) return { name: null, path: found.path, removedManifest: false };

  const { [name]: _dropped, ...projects } = found.manifest.projects;
  if (Object.keys(projects).length === 0) {
    await rm(found.path, { force: true });
    return { name, path: found.path, removedManifest: true };
  }
  const manifest: Manifest = {
    ...found.manifest,
    projects,
    ...(found.manifest.defaultProject === name ? { defaultProject: undefined } : {}),
  };
  if (manifest.defaultProject === undefined) delete manifest.defaultProject;
  await writeFile(found.path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { name, path: found.path, removedManifest: false };
}

/** Walk up from `start` for a `.git` entry (dir, or file for worktrees). */
async function findGitRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  while (true) {
    try {
      await stat(join(dir, ".git"));
      return dir;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Directories a repo scan should never descend into. */
const SCAN_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".velloo",
]);

/**
 * Design folders already sitting in the repo, found by a shallow walk. Used
 * only when {@link registerProject} *creates* the manifest: a repo that grew a
 * second design folder must not end up with a manifest naming only the new
 * one, because a manifest shadows the `./velloo` convention entirely — the
 * older folder would vanish from every command that resolves through it.
 */
export async function discoverDesignFolders(root: string, maxDepth = 3): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SCAN_SKIP.has(entry.name)) continue;
      const child = join(dir, entry.name);
      try {
        await stat(join(child, ".design", "config.json"));
        out.push(child);
        continue; // a design folder never nests another
      } catch {
        // not a design folder — keep descending
      }
      if (depth < maxDepth) await walk(child, depth + 1);
    }
  };
  await walk(resolve(root), 1);
  return out.sort();
}

function deriveName(folder: string): string {
  // `apps/web/velloo` should read as project "web", not "velloo" — the
  // default folder name says nothing about which app it designs.
  const base = basename(folder);
  const candidate = base === "velloo" || base === "." ? basename(dirname(folder)) : base;
  const sanitized = candidate
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "");
  return sanitized || "app";
}

export interface RegisterResult {
  name: string;
  /** Absolute path of the manifest that now lists the project. */
  path: string;
  /** False when the folder was already registered (no write happened). */
  created: boolean;
}

/**
 * Record a design folder as a project in the repo's `velloo.json` — an
 * existing manifest above the folder wins, else one is created at the git
 * root (or the app root outside a repo). Re-registering the same folder is a
 * no-op that keeps its existing name.
 */
export async function registerProject(
  folder: string,
  appRoot: string,
  requestedName?: string,
): Promise<RegisterResult> {
  if (requestedName && !PROJECT_NAME.test(requestedName)) {
    throw new Error(
      `invalid --project ${JSON.stringify(requestedName)} — names are letters/digits plus . _ -`,
    );
  }
  const abs = resolve(folder);
  const found = await findManifest(abs);
  const dir = found ? found.dir : ((await findGitRoot(appRoot)) ?? resolve(appRoot));
  const path = found ? found.path : join(dir, MANIFEST_FILE);

  const projects: Record<string, string> = { ...(found?.manifest.projects ?? {}) };
  for (const [existing, target] of found?.folders ?? []) {
    if (target === abs) return { name: existing, path, created: false };
  }

  const add = (folder: string, wanted?: string): string => {
    let name = wanted ?? deriveName(folder);
    for (let n = 2; name in projects; n++) name = `${wanted ?? deriveName(folder)}-${n}`;
    projects[name] = relative(dir, folder) || ".";
    return name;
  };

  // Creating the manifest for the first time: adopt the design folders that
  // are already here, or they'd be shadowed the moment this file exists.
  let defaultProject = found?.manifest.defaultProject;
  if (!found) {
    for (const sibling of await discoverDesignFolders(dir)) {
      if (sibling === abs) continue;
      const name = add(sibling);
      // The conventional `<root>/velloo` was what every command resolved to
      // before the manifest existed — keep it the default so nothing else
      // changes behaviour on the day a second folder appears.
      if (sibling === join(dir, DEFAULT_FOLDER_NAME)) defaultProject = name;
    }
  }

  const name = add(abs, requestedName);

  const manifest: Manifest = {
    ...(found?.manifest ?? {}),
    projects,
    ...(defaultProject ? { defaultProject } : {}),
  };
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { name, path, created: true };
}
