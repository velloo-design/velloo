import { type Dirent, existsSync, realpathSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ConfigSchema, designNameIssue, type RepoManifest, toDesignName } from "@velloo/schema";
import {
  type DesignSet,
  type FoundRepoManifest,
  findDesigns as findDesignsLenient,
  localDesignOf,
  readRepoManifest,
  recordedDesignName,
  writeJsonAtomic,
  writeLocalDesign,
} from "@velloo/server";

/**
 * The write side of a checkout's designs. Reading — the merged list of
 * `velloo.json` paths and this machine's local designs, and picking one — lives
 * in `@velloo/server`'s `designs.ts`, which the daemon shares. A design's name
 * is in its own config; `velloo.json` only says where the repository's designs
 * are.
 */
const MANIFEST_FILE = "velloo.json";

/** The conventional design-folder name, when a repo has no manifest yet. */
const DEFAULT_FOLDER_NAME = "velloo";

/** The repo manifest above `startDir`; throws on a broken one. */
export function findManifest(startDir: string): Promise<FoundRepoManifest | null> {
  return readRepoManifest(startDir, { strict: true });
}

/** The designs visible from `cwd`; throws on a broken manifest. */
export function findDesigns(cwd: string): Promise<DesignSet | null> {
  return findDesignsLenient(cwd, { strict: true });
}

function sameFolder(a: string, b: string): boolean {
  return a === b || (existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b));
}

/** Refuse to write a manifest still in the pre-designs shape — see `FoundRepoManifest.legacy`. */
function assertCurrent(found: FoundRepoManifest): void {
  if (found.legacy)
    throw new Error(
      `${found.path} is in the pre-designs format (\`projects\`) — run \`velloo upgrade\` to migrate it first.`,
    );
}

/**
 * Describe a design for display: "name — rel/path (in /repo/root)" for a
 * repository design, "name — /path (local, for /checkout)" for a local one;
 * null otherwise (callers fall back to the raw path). Display-only, so a broken
 * manifest degrades to the fallback.
 */
export async function designLabel(folder: string): Promise<string | null> {
  const abs = resolve(folder);
  const name = recordedDesignName(abs);
  const local = localDesignOf(abs);
  if (local)
    return `${name ?? local.legacyName ?? basename(abs)} — ${abs} (local, for ${local.root})`;
  let found: FoundRepoManifest | null;
  try {
    found = await findManifest(abs);
  } catch {
    return null;
  }
  const entry = found?.folders.find((path) => sameFolder(path, abs));
  if (!found || !entry) return null;
  const rel = relative(found.dir, abs) || ".";
  return `${name ?? found.legacyNames.get(entry) ?? basename(abs)} — ${rel} (in ${found.dir})`;
}

export interface UnregisterResult {
  /** Name of the design that was removed, or null when the folder wasn't listed. */
  name: string | null;
  /** Manifest path, when there was one. */
  path: string | null;
  /** True when the manifest went away entirely (its last design left). */
  removedManifest: boolean;
}

/**
 * Drop a design folder from the repo manifest. When its last design goes the
 * file goes with it — unless it still carries repo preferences: a manifest
 * listing nothing shadows the `./velloo` convention while naming nothing.
 */
export async function unregisterDesign(folder: string, cwd: string): Promise<UnregisterResult> {
  const abs = resolve(folder);
  const found = await findManifest(cwd);
  if (!found) return { name: null, path: null, removedManifest: false };
  const index = found.folders.findIndex((path) => sameFolder(path, abs));
  if (index === -1) return { name: null, path: found.path, removedManifest: false };
  assertCurrent(found);
  const name = recordedDesignName(abs) ?? basename(abs);
  const manifest = withoutDesign(found.manifest, index, name);
  if (manifest === null) {
    await rm(found.path, { force: true });
    return { name, path: found.path, removedManifest: true };
  }
  await writeJsonAtomic(found.path, manifest);
  return { name, path: found.path, removedManifest: false };
}

/**
 * The manifest without its `index`th design, or null when nothing worth keeping
 * is left. `name` clears a `defaultDesign` that pointed at it.
 */
export function withoutDesign(
  manifest: RepoManifest,
  index: number,
  name: string,
): RepoManifest | null {
  const designs = manifest.designs.filter((_, i) => i !== index);
  const { defaultDesign, ...rest } = manifest;
  if (designs.length === 0 && !rest.feedback) return null;
  return {
    ...rest,
    designs,
    ...(defaultDesign && defaultDesign !== name ? { defaultDesign } : {}),
  };
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

function deriveName(folder: string, manifestDir?: string): string {
  // `apps/web/velloo` should read as design "web", not "velloo" — the default
  // folder name says nothing about which app it designs. At the manifest's own
  // level the parent is the whole repo, whose name says even less, and
  // siblings like `brand/` are named for their folders too.
  const base = basename(folder);
  const nested = base === DEFAULT_FOLDER_NAME && dirname(folder) !== manifestDir;
  return toDesignName(nested ? basename(dirname(folder)) : base) ?? "app";
}

export interface NameRequest {
  /** The design folder being created or registered. */
  folder: string;
  /** The application it designs. */
  appRoot: string;
  /**
   * Where it is recorded: `repository` (a `velloo.json` path), `chosen` (a local
   * design at a path the user picked) or `managed` (a local design in storage).
   */
  storage: "repository" | "chosen" | "managed";
  /** The checkout, for a local design. */
  checkout?: string | undefined;
  /** An explicit `--name`; refused rather than suffixed when it is taken. */
  requested?: string | undefined;
}

/**
 * The name a new design gets: an explicit request, else one derived from its
 * folder (or, where the folder name says nothing, its application), made
 * unique among the checkout's designs with a `-2`, `-3` suffix.
 */
export async function chooseDesignName(request: NameRequest): Promise<string> {
  const folder = resolve(request.folder);
  const issue = request.requested === undefined ? null : designNameIssue(request.requested);
  if (issue) throw new Error(`invalid --name ${JSON.stringify(request.requested)} — ${issue}`);
  const taken = await takenNames(request, folder);
  if (request.requested) {
    const holder = taken.get(request.requested);
    if (holder)
      throw new Error(
        `a design named "${request.requested}" already exists at ${holder} — pick another --name.`,
      );
    return request.requested;
  }
  let base: string;
  if (request.storage === "repository") {
    const found = await findManifest(folder).catch(() => null);
    const dir = found?.dir ?? (await manifestDirFor(folder, request.appRoot));
    // The folder's own name — `admin/` is design "admin" — except the generic
    // `velloo/`, which says nothing and takes its app's name when nested in one.
    base = deriveName(folder, dir);
  } else {
    // A folder the user chose is named for itself; managed storage (a UUID)
    // and a generic `velloo` folder are named for the app they design.
    const chosen = request.storage === "chosen" && basename(folder) !== DEFAULT_FOLDER_NAME;
    base = deriveName(chosen ? folder : request.appRoot);
  }
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

/** Name → folder for every design the new one must not collide with. */
async function takenNames(request: NameRequest, folder: string): Promise<Map<string, string>> {
  const from = request.checkout ?? dirname(folder);
  const taken = new Map<string, string>();
  const set = await findDesigns(from).catch(() => null);
  for (const design of set?.designs ?? []) {
    if (!sameFolder(design.root, folder)) taken.set(design.name, design.root);
  }
  // Designs sitting in a repo with no manifest yet are adopted when it is
  // created, so their names are spoken for too.
  if (!set?.repo) {
    const root = request.checkout ?? (await findGitRoot(request.appRoot)) ?? dirname(folder);
    for (const sibling of await discoverDesignFolders(root)) {
      const name = recordedDesignName(sibling);
      if (name && !sameFolder(sibling, folder)) taken.set(name, sibling);
    }
  }
  return taken;
}

/** Set a design's name in its config. Callers check uniqueness and stop its daemon. */
export async function writeDesignName(folder: string, name: string): Promise<void> {
  const path = join(folder, ".design", "config.json");
  const config = ConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  await writeJsonAtomic(path, { ...config, name });
}

export interface RegisterResult {
  /** The design's name. */
  name: string;
  /** Absolute path of the manifest that now lists the design. */
  path: string;
  /** False when the folder was already listed (no write happened). */
  created: boolean;
}

/**
 * List a design folder in the repo's `velloo.json` — an existing manifest above
 * the folder wins, else one is created at the git root (or the app root outside
 * a repo). Re-registering a listed folder is a no-op. The folder must already
 * carry its name, and that name must be free.
 */
export async function registerDesign(folder: string, appRoot: string): Promise<RegisterResult> {
  const abs = resolve(folder);
  const name = recordedDesignName(abs);
  if (!name) throw new Error(`${abs} has no design name — run \`velloo upgrade ${abs}\` first.`);
  const found = await findManifest(abs);
  const dir = found ? found.dir : await manifestDirFor(abs, appRoot);
  const path = found ? found.path : join(dir, MANIFEST_FILE);
  if (found?.folders.some((target) => sameFolder(target, abs)))
    return { name, path, created: false };
  if (found) assertCurrent(found);

  const set = await findDesigns(dir);
  const clash = set?.designs.find((d) => d.name === name && !sameFolder(d.root, abs));
  if (clash)
    throw new Error(
      `a design named "${name}" already exists at ${clash.root} — rename one with \`velloo design rename\`.`,
    );

  const designs = [...(found?.manifest.designs ?? [])];
  const rel = (target: string) => relative(dir, target).split("\\").join("/") || ".";
  // Creating the manifest for the first time: adopt the design folders that
  // are already here, or they'd be shadowed the moment this file exists.
  let defaultDesign = found?.manifest.defaultDesign;
  if (!found) {
    for (const sibling of await discoverDesignFolders(dir)) {
      if (sibling === abs) continue;
      designs.push(rel(sibling));
      // The conventional `<root>/velloo` was what every command resolved to
      // before the manifest existed — keep it the default so nothing else
      // changes behaviour on the day a second folder appears.
      if (sibling === join(dir, DEFAULT_FOLDER_NAME))
        defaultDesign = recordedDesignName(sibling) ?? undefined;
    }
  }
  designs.push(rel(abs));

  const manifest: RepoManifest = {
    ...(found?.manifest ?? {}),
    designs,
    ...(defaultDesign ? { defaultDesign } : {}),
  };
  await writeJsonAtomic(path, manifest);
  return { name, path, created: true };
}

export interface LocalRegistration {
  id: string;
  root: string;
  appRoot: string;
  /** A folder the user chose; omitted for managed storage. */
  designPath?: string | undefined;
}

/** Record a local design for a checkout on this machine. Nothing is written into the checkout. */
export async function registerLocalDesign(opts: LocalRegistration): Promise<void> {
  await writeLocalDesign(opts.id, {
    root: opts.root,
    appRoot: opts.appRoot,
    ...(opts.designPath ? { designPath: opts.designPath } : {}),
  });
}
