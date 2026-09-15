import { type Dirent, existsSync, realpathSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type RepoManifest, RepoManifestSchema } from "@velloo/schema";
import {
  type LocalDesign,
  localDesignOf,
  localDesignsAt,
  writeJsonAtomic,
  writeLocalDesign,
} from "@velloo/server";

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
      const projects = (parsed as { projects?: unknown } | null)?.projects;
      for (const [name, entry] of Object.entries(
        projects && typeof projects === "object" ? projects : {},
      )) {
        if (entry && typeof entry === "object" && "managed" in entry)
          throw new Error(
            `${path}: project "${name}" is a managed design locator, which velloo.json no longer holds — a design outside the repository is recorded only on the machine that has it. Remove the entry, then run \`velloo folder bind <design folder>\` from this checkout.`,
          );
      }
      const result = ManifestSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new Error(`${path} is not a valid velloo manifest: ${issues}`);
      }
      const folders = new Map(
        Object.entries(result.data.projects).map(([name, rel]) => [
          name,
          resolve(dir, rel.replace(/\\/g, "/")),
        ]),
      );
      return { path, dir, manifest: result.data, folders };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The projects visible from a directory: the committed `velloo.json` above it
 * and the local designs this machine records for a checkout containing it,
 * merged into one name space. Null when there are neither.
 */
export interface ProjectSet {
  repo: FoundManifest | null;
  local: LocalDesign[];
  /** Project name → absolute design folder, both kinds. */
  folders: Map<string, string>;
  defaultProject: string | undefined;
}

export async function findProjects(cwd: string): Promise<ProjectSet | null> {
  const repo = await findManifest(cwd);
  const local = localDesignsAt(cwd);
  if (!repo && local.length === 0) return null;
  const folders = new Map(repo?.folders ?? []);
  for (const design of local) {
    const clash = folders.get(design.projectName);
    if (clash !== undefined)
      throw new Error(
        `Project "${design.projectName}" names both ${clash} (in ${repo?.path ?? "another local design"}) and the local design ${design.designRoot}. Remove one with \`velloo folder remove\`, or rename the velloo.json entry.`,
      );
    folders.set(design.projectName, design.designRoot);
  }
  return { repo, local, folders, defaultProject: repo?.manifest.defaultProject };
}

/**
 * Pick the project `cwd` implies, or null when only a human (or
 * defaultProject) can disambiguate. Containment beats everything: standing
 * inside a local design's application, inside a project's folder, or inside a
 * directory that holds exactly one project (an app dir in a monorepo) is an
 * unambiguous choice.
 */
export function pickProject(projects: ProjectSet, cwd: string): string | null {
  const entries = [...projects.folders];
  const appMatches = projects.local.filter(
    (design) =>
      resolve(design.appRoot) !== resolve(design.root) && isWithin(resolve(design.appRoot), cwd),
  );
  if (appMatches.length === 1 && appMatches[0]) return appMatches[0].projectName;
  const containing = entries.find(([, folder]) => cwd === folder || cwd.startsWith(folder + sep));
  if (containing) return containing[0];
  const under = entries.filter(([, folder]) => folder.startsWith(cwd + sep));
  if (under.length === 1 && under[0]) return under[0][0];
  if (entries.length === 1 && entries[0]) return entries[0][0];
  return projects.defaultProject ?? null;
}

/**
 * Describe a design folder in project terms for display: "name — rel/path
 * (in /repo/root)" for a `velloo.json` entry, "name — /path (local, for
 * /checkout)" for a local design; null otherwise (callers fall back to the
 * raw path). Display-only, so a broken manifest degrades to the fallback.
 */
export async function projectLabel(folder: string): Promise<string | null> {
  const abs = resolve(folder);
  const local = localDesignOf(abs);
  if (local) return `${local.projectName} — ${abs} (local, for ${local.root})`;
  let found: FoundManifest | null;
  try {
    found = await findManifest(abs);
  } catch {
    return null;
  }
  if (!found) return null;
  const entry = [...found.folders].find(
    ([, path]) =>
      path === abs ||
      (existsSync(path) && existsSync(abs) && realpathSync(path) === realpathSync(abs)),
  );
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
    if (
      target === abs ||
      (existsSync(target) && existsSync(abs) && realpathSync(target) === realpathSync(abs))
    )
      name = candidate;
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

/**
 * Where a new `velloo.json` for this folder goes: the git root, else the
 * nearest directory holding both the app and the design folder.
 */
async function manifestDirFor(folder: string, appRoot: string): Promise<string> {
  const git = await findGitRoot(appRoot);
  if (git) return git;
  let dir = resolve(appRoot);
  while (!isWithin(dir, folder) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

/**
 * The checkout a new design belongs to: the `velloo.json` already above where
 * init ran, else the git root, else where init ran (or the app itself, when
 * it sits outside that). A design folder outside it becomes a local design.
 */
export async function checkoutRoot(appRoot: string, launchRoot: string): Promise<string> {
  const found = await findManifest(launchRoot).catch(() => null);
  if (found) return found.dir;
  const git = await findGitRoot(appRoot);
  if (git) return git;
  return isWithin(resolve(launchRoot), resolve(appRoot)) ? resolve(launchRoot) : resolve(appRoot);
}

export function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Walk up from `start` for a `.git` entry (dir, or file for worktrees),
 * stopping below the home directory: a repository there is a dotfiles
 * checkout, and a design folder made in a plain directory must not join it.
 */
export async function findGitRoot(start: string): Promise<string | null> {
  const home = homedir();
  let dir = resolve(start);
  while (dir !== home) {
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
  return null;
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
  checkProjectName(requestedName);
  const abs = resolve(folder);
  const found = await findManifest(abs);
  const dir = found ? found.dir : await manifestDirFor(abs, appRoot);
  const path = found ? found.path : join(dir, MANIFEST_FILE);
  const localNames = new Set(localDesignsAt(dir).map((design) => design.projectName));

  const projects: Manifest["projects"] = { ...(found?.manifest.projects ?? {}) };
  for (const [existing, target] of found?.folders ?? []) {
    if (
      target === abs ||
      (existsSync(target) && existsSync(abs) && realpathSync(target) === realpathSync(abs))
    )
      return { name: existing, path, created: false };
  }

  const add = (folder: string, wanted?: string): string => {
    let name = wanted ?? deriveName(folder);
    for (let n = 2; name in projects || localNames.has(name); n++)
      name = `${wanted ?? deriveName(folder)}-${n}`;
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

  // A folder beside the app rather than inside it (init run from a monorepo
  // root for `frontend/`) is named for the app — "chainlit" says nothing.
  const outsideApp = !isWithin(resolve(appRoot), abs);
  const name = add(abs, requestedName ?? (outsideApp ? deriveName(appRoot) : undefined));

  const manifest: Manifest = {
    ...(found?.manifest ?? {}),
    projects,
    ...(defaultProject ? { defaultProject } : {}),
  };
  await writeJsonAtomic(path, manifest);
  return { name, path, created: true };
}

function checkProjectName(name: string | undefined): void {
  if (name && !PROJECT_NAME.test(name)) {
    throw new Error(
      `invalid --project ${JSON.stringify(name)} — names are letters/digits plus . _ -`,
    );
  }
}

export interface LocalRegistration {
  id: string;
  root: string;
  appRoot: string;
  /** A folder the user chose; omitted for managed storage. */
  designPath?: string | undefined;
  requestedName?: string | undefined;
}

/**
 * Record a local design for a checkout on this machine. Nothing is written
 * into the checkout. The name avoids every project the checkout already sees;
 * an explicitly requested name that is taken is refused instead.
 */
export async function registerLocalDesign(opts: LocalRegistration): Promise<string> {
  checkProjectName(opts.requestedName);
  const existing = localDesignsAt(opts.root).find((design) => design.id === opts.id);
  const taken = new Set((await findProjects(opts.root))?.folders.keys() ?? []);
  if (existing) taken.delete(existing.projectName);
  const base = opts.requestedName ?? existing?.projectName ?? deriveName(opts.appRoot);
  if (opts.requestedName && taken.has(base))
    throw new Error(`project "${base}" already exists for ${opts.root} — pick another --project.`);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  await writeLocalDesign(opts.id, {
    root: opts.root,
    appRoot: opts.appRoot,
    projectName: name,
    ...(opts.designPath ? { designPath: opts.designPath } : {}),
  });
  return name;
}
