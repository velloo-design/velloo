import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  designNameIssue,
  isDesignName,
  normalizeRepoManifest,
  REPO_MANIFEST_FILE,
  type RepoManifest,
  RepoManifestSchema,
  toDesignName,
} from "@velloo/schema";
import { writeJsonAtomic } from "./fs.ts";
import { type LocalDesign, localDesignOf, localDesignsAt } from "./project-location.ts";

/**
 * The designs a checkout has, wherever they are stored. A design is a folder
 * holding `.design/config.json`, and its name lives in that config. Where it is
 * recorded depends on where it is kept: inside the repository it is a path in
 * the committed `velloo.json`; outside it, a record on this machine only (see
 * `project-location.ts`). This module merges both into one list of names.
 *
 * It lives in the server rather than the CLI because the daemon needs it too:
 * an agent session is told which of the checkout's designs it is working on.
 */

export interface FoundRepoManifest {
  /** Absolute path of the velloo.json file. */
  path: string;
  /** Directory holding it — design paths resolve against this. */
  dir: string;
  manifest: RepoManifest;
  /** Absolute design-folder paths, in file order. */
  folders: string[];
  /**
   * True when the file still has the pre-v4 `projects` map. It is readable,
   * but writers refuse it until `velloo upgrade` rewrites it — rewriting it
   * sooner would lose the names folders not yet migrated still depend on.
   */
  legacy: boolean;
  /** Absolute path → the name a pre-v4 `projects` map gave it. */
  legacyNames: Map<string, string>;
}

/**
 * Walk up from `startDir` for a `velloo.json`. A missing file keeps walking. A
 * present-but-broken one throws with its path when `strict` (a typo'd manifest
 * silently falling back to convention would resolve the wrong design), and
 * reads as absent otherwise — the daemon must not refuse to boot over it.
 */
export async function readRepoManifest(
  startDir: string,
  opts: { strict?: boolean } = {},
): Promise<FoundRepoManifest | null> {
  let dir = resolve(startDir);
  for (;;) {
    const path = join(dir, REPO_MANIFEST_FILE);
    let raw: string | null = null;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        if (opts.strict) throw err;
        return null;
      }
    }
    if (raw !== null) {
      try {
        return parseManifest(path, dir, raw);
      } catch (err) {
        if (opts.strict) throw err;
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function parseManifest(path: string, dir: string, raw: string): FoundRepoManifest {
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
        `${path}: "${name}" is a managed design locator, which velloo.json no longer holds — a design outside the repository is recorded only on the machine that has it. Remove the entry, then run \`velloo design bind <design folder>\` from this checkout.`,
      );
  }
  const normalized = normalizeRepoManifest(parsed);
  const result = RepoManifestSchema.safeParse(normalized.manifest);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${path} is not a valid velloo manifest: ${issues}`);
  }
  const absolute = (rel: string) => resolve(dir, rel.replace(/\\/g, "/"));
  return {
    path,
    dir,
    manifest: result.data,
    folders: result.data.designs.map(absolute),
    legacy: normalized.legacy,
    legacyNames: new Map(
      Object.entries(normalized.legacyNames).map(([rel, name]) => [absolute(rel), name]),
    ),
  };
}

/**
 * A design's name as its config records it, or null when the folder is
 * missing, unreadable, or from before designs carried names.
 */
export function recordedDesignName(folder: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(folder, ".design", "config.json"), "utf8")) as {
      name?: unknown;
    };
    return typeof raw.name === "string" && isDesignName(raw.name) ? raw.name : null;
  } catch {
    return null;
  }
}

export interface DesignEntry {
  name: string;
  /** Absolute design folder. */
  root: string;
  /** The machine record, when the design lives outside the checkout. */
  local: LocalDesign | null;
  /** False when nothing at `root` is a design folder (a stale entry). */
  exists: boolean;
  /**
   * True for a `velloo.json` entry that resolves outside its repository. The
   * file is committed, so a cloned repo must not be able to aim Velloo
   * elsewhere: such an entry is listed only so it can be reported.
   */
  outsideRepo: boolean;
}

export interface DesignSet {
  repo: FoundRepoManifest | null;
  local: LocalDesign[];
  /** Every design, sorted by name. */
  designs: DesignEntry[];
  byName: Map<string, DesignEntry>;
  /** Names more than one design claims — resolvable only by path. */
  conflicts: Map<string, DesignEntry[]>;
  defaultDesign: string | undefined;
}

function realOr(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

/**
 * The designs visible from a directory: the committed `velloo.json` above it
 * and the local designs this machine records for a checkout containing it.
 * Null when there are neither. `strict` throws on a broken manifest.
 */
export async function findDesigns(
  cwd: string,
  opts: { strict?: boolean } = {},
): Promise<DesignSet | null> {
  const repo = await readRepoManifest(cwd, opts);
  const local = localDesignsAt(cwd);
  if (!repo && local.length === 0) return null;

  const entries: DesignEntry[] = [];
  const seen = new Set<string>();
  const repoReal = repo ? realOr(repo.dir) : null;
  const add = (root: string, record: LocalDesign | null, fallback: string | undefined) => {
    // A stale entry has no realpath; place it against the repository's own, so
    // a symlinked checkout (macOS `/tmp`) doesn't read it as outside.
    const real =
      existsSync(root) || !repo || !repoReal
        ? realOr(root)
        : resolve(repoReal, relative(repo.dir, root));
    if (seen.has(real)) return;
    seen.add(real);
    const outsideRepo = !record && repoReal !== null && !isUnder(repoReal, real);
    const exists = existsSync(join(root, ".design", "config.json"));
    const name = recordedDesignName(root) ?? fallback ?? toDesignName(basename(root)) ?? "design";
    entries.push({ name, root, local: record, exists, outsideRepo });
  };
  for (const folder of repo?.folders ?? []) add(folder, null, repo?.legacyNames.get(folder));
  for (const design of local) add(design.designRoot, design, design.legacyName);

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map<string, DesignEntry>();
  const conflicts = new Map<string, DesignEntry[]>();
  for (const entry of entries) {
    const clash = byName.get(entry.name);
    if (clash) conflicts.set(entry.name, [...(conflicts.get(entry.name) ?? [clash]), entry]);
    else byName.set(entry.name, entry);
  }
  for (const name of conflicts.keys()) byName.delete(name);
  return {
    repo,
    local,
    designs: entries,
    byName,
    conflicts,
    defaultDesign: repo?.manifest.defaultDesign,
  };
}

/** The design set a design belongs to, found from its own checkout rather than a cwd. */
export async function designsFor(designRoot: string): Promise<DesignSet | null> {
  const local = localDesignOf(designRoot);
  return findDesigns(local ? local.root : designRoot);
}

/** How a design was chosen when no name was given. */
export type DesignPickReason = "cwd" | "only" | "default" | "arbitrary";

export interface DesignPick {
  design: DesignEntry;
  reason: DesignPickReason;
}

/**
 * The design `cwd` implies. Containment beats everything: standing inside a
 * local design's application, inside a design's folder, or inside a directory
 * that holds exactly one design is an unambiguous choice. Then the only
 * design, then `defaultDesign`. Failing all of those, the first by name with
 * reason `arbitrary` — callers that can ask a person should, rather than use it.
 */
export function pickDesign(set: DesignSet, cwd: string): DesignPick | null {
  const here = resolve(cwd);
  const usable = set.designs.filter(
    (d) => d.exists && !d.outsideRepo && set.byName.get(d.name) === d,
  );
  const appMatches = usable.filter(
    (d) =>
      d.local &&
      resolve(d.local.appRoot) !== resolve(d.local.root) &&
      isUnder(resolve(d.local.appRoot), here),
  );
  if (appMatches.length === 1 && appMatches[0]) return { design: appMatches[0], reason: "cwd" };
  const containing = usable.find((d) => here === d.root || here.startsWith(d.root + sep));
  if (containing) return { design: containing, reason: "cwd" };
  // A directory below the checkout root holding exactly one design — an app
  // folder in a monorepo — means that one. Not the root itself: a design kept
  // outside the checkout is never "under" it, so counting there would quietly
  // pick the in-repo design over it.
  const checkout = set.repo?.dir ?? set.local[0]?.root;
  const belowRoot = checkout !== undefined && here.startsWith(resolve(checkout) + sep);
  const under = usable.filter((d) => d.root.startsWith(here + sep));
  if (belowRoot && under.length === 1 && under[0]) return { design: under[0], reason: "cwd" };
  if (usable.length === 1 && usable[0]) return { design: usable[0], reason: "only" };
  const byDefault = set.defaultDesign ? set.byName.get(set.defaultDesign) : undefined;
  if (byDefault?.exists) return { design: byDefault, reason: "default" };
  return usable[0] ? { design: usable[0], reason: "arbitrary" } : null;
}

function isUnder(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * Why `root` can't be renamed to `name`, or null when it can: the name must be
 * valid and free among its checkout's designs, and a pre-v4 manifest must be
 * upgraded first (its map still carries names).
 */
export async function designRenameConflict(root: string, name: string): Promise<string | null> {
  const issue = designNameIssue(name);
  if (issue) return `${issue[0]?.toUpperCase()}${issue.slice(1)}.`;
  const set = await designsFor(root);
  const here = realOr(root);
  const holder = set?.designs.find((d) => d.name === name && realOr(d.root) !== here);
  if (holder) return `A design named "${name}" already exists at ${holder.root}.`;
  if (set?.repo?.legacy)
    return `${set.repo.path} is in the pre-designs format — run \`velloo upgrade\` first.`;
  return null;
}

/**
 * Keep `velloo.json`'s `defaultDesign` pointing at a renamed design. True when
 * it named the old name and now names the new one.
 */
export async function followDesignRename(
  root: string,
  previous: string,
  name: string,
): Promise<boolean> {
  const repo = (await designsFor(root))?.repo;
  if (!repo || repo.legacy || repo.manifest.defaultDesign !== previous) return false;
  await writeJsonAtomic(repo.path, { ...repo.manifest, defaultDesign: name });
  return true;
}
