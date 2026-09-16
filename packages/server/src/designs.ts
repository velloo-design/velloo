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
 * The `velloo.json` in `dir` itself — never one above it. A command resolves
 * designs from the directory it runs in, so a manifest further up belongs to a
 * different, independent project (`app/` and `app/admin/` each have their own).
 * A present-but-broken file throws with its path when `strict` (a typo'd
 * manifest silently reading as absent would resolve the wrong design), and
 * reads as absent otherwise — the daemon must not refuse to boot over it.
 */
export async function readRepoManifestAt(
  dir: string,
  opts: { strict?: boolean } = {},
): Promise<FoundRepoManifest | null> {
  const at = resolve(dir);
  const path = join(at, REPO_MANIFEST_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && opts.strict) throw err;
    return null;
  }
  try {
    return parseManifest(path, at, raw);
  } catch (err) {
    if (opts.strict) throw err;
    return null;
  }
}

/**
 * The `velloo.json` that lists `folder`, for code that starts from a design
 * rather than from where a person stands (a rename, the daemon's session). It
 * looks in the directories above the folder, but only a manifest that actually
 * names this folder counts: an unrelated one higher up is another project.
 */
export async function findOwningManifest(
  folder: string,
  opts: { strict?: boolean } = {},
): Promise<FoundRepoManifest | null> {
  const target = realOr(folder);
  // Starts at the folder itself: a project can be its own design (`"designs": ["."]`).
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    const found = await readRepoManifestAt(dir, opts);
    if (found?.folders.some((listed) => realOr(listed) === target)) return found;
    if (dirname(dir) === dir) return null;
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

function isUnder(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

function realOr(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

/**
 * The designs of the project at `cwd`: the `velloo.json` in that directory and
 * the local designs this machine records for it. Nothing above `cwd` is
 * consulted. Null when there are neither. `strict` throws on a broken manifest.
 */
export async function findDesigns(
  cwd: string,
  opts: { strict?: boolean } = {},
): Promise<DesignSet | null> {
  const repo = await readRepoManifestAt(cwd, opts);
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

/** The design set a design belongs to: the project that lists or records it. */
export async function designsFor(designRoot: string): Promise<DesignSet | null> {
  const local = localDesignOf(designRoot);
  if (local) return findDesigns(local.root);
  const owner = await findOwningManifest(designRoot);
  return owner ? findDesigns(owner.dir) : null;
}

/** How a design was chosen when no name was given. */
export type DesignPickReason = "cwd" | "only" | "default" | "arbitrary";

export interface DesignPick {
  design: DesignEntry;
  reason: DesignPickReason;
}

/**
 * The design a project's set implies when none was named: standing in a
 * design's own folder, then the only design, then `defaultDesign`. Failing
 * those, the first by name with reason `arbitrary` — callers that can ask a
 * person should, rather than use it. A name two designs share still counts for
 * `arbitrary`, so an agent session opens something instead of exiting.
 */
export function pickDesign(set: DesignSet, cwd: string): DesignPick | null {
  const here = realOr(cwd);
  const present = set.designs.filter((d) => d.exists && !d.outsideRepo);
  const usable = present.filter((d) => set.byName.get(d.name) === d);
  const standingIn = usable.find((d) => realOr(d.root) === here);
  if (standingIn) return { design: standingIn, reason: "cwd" };
  if (usable.length === 1 && usable[0] && present.length === 1)
    return { design: usable[0], reason: "only" };
  const byDefault = set.defaultDesign ? set.byName.get(set.defaultDesign) : undefined;
  if (byDefault?.exists) return { design: byDefault, reason: "default" };
  return present[0] ? { design: present[0], reason: "arbitrary" } : null;
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
