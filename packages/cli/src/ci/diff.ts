import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { Screen, Snippet } from "@velloo/schema";

/**
 * Changed-screen detection for `publish --changed-since`: diff the design
 * folder between two git refs and expand indirect dependencies — the cheap
 * correct rules:
 *
 *   - `screens/<id>.json` changed          → that screen (add / modify / delete)
 *   - `theme/**` or `.design/config.json`  → every screen (theme + registry
 *                                            config affect all renders)
 *   - `snippets/<id>.json` changed         → screens whose trees instantiate it
 *                                            (transitively through snippet bodies)
 *   - `assets/**` changed                  → screens referencing `/assets/<path>`
 *                                            (directly or via a used snippet)
 *
 * Boards, annotations sidecars, and `.design/links.json` don't affect a
 * screen's pixels, so they never mark screens changed.
 */

type GitFileStatus = "A" | "M" | "D";

export interface RawChange {
  status: GitFileStatus;
  /** Path relative to the design folder root (e.g. "screens/home.json"). */
  path: string;
}

export interface DesignChangeSet {
  /** Directly-changed screens (filename stem → status). */
  screens: Map<string, GitFileStatus>;
  /** theme/** or .design/config.json changed — every screen re-renders. */
  global: boolean;
  /** Changed snippet ids. */
  snippets: Set<string>;
  /** Changed assets, in the reference form screens use ("/assets/logo.png"). */
  assets: Set<string>;
}

type ScreenChangeStatus = "added" | "modified" | "deleted";

export interface ChangedScreen {
  id: string;
  status: ScreenChangeStatus;
  /** Why the screen is in the changed set ("screen", "theme", "snippet:x", "asset:/assets/x"). */
  reasons: string[];
}

/** Filename stem for `<dir>/<stem>.json`; null for sidecars (`x.annotations.json`) or other files. */
function plainJsonStem(path: string, dir: string): string | null {
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".json")) return null;
  const stem = path.slice(prefix.length, -".json".length);
  if (stem.includes("/") || stem.includes(".")) return null;
  return stem;
}

export function classifyChanges(changes: RawChange[]): DesignChangeSet {
  const set: DesignChangeSet = {
    screens: new Map(),
    global: false,
    snippets: new Set(),
    assets: new Set(),
  };
  for (const { status, path } of changes) {
    const screen = plainJsonStem(path, "screens");
    if (screen) {
      set.screens.set(screen, status);
      continue;
    }
    if (path.startsWith("theme/") || path === ".design/config.json") {
      set.global = true;
      continue;
    }
    const snippet = plainJsonStem(path, "snippets");
    if (snippet) {
      set.snippets.add(snippet);
      continue;
    }
    if (path.startsWith("assets/")) set.assets.add(`/${path}`);
  }
  return set;
}

/** Every `$snippet` id reachable in a JSON value (covers slot args + overrides). */
function snippetIdsIn(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) snippetIdsIn(v, acc);
    return;
  }
  if (value !== null && typeof value === "object") {
    const id = (value as { $snippet?: unknown }).$snippet;
    if (typeof id === "string") acc.add(id);
    for (const v of Object.values(value)) snippetIdsIn(v, acc);
  }
}

/**
 * Snippet ids a screen uses, transitively: instances in the screen tree plus
 * instances inside the bodies of any used snippet. Bounded by the snippet
 * count, so cycles can't loop.
 */
export function snippetsUsedByScreen(screen: Screen, snippets: Map<string, Snippet>): Set<string> {
  const used = new Set<string>();
  snippetIdsIn(screen.tree, used);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...used]) {
      const body = snippets.get(id);
      if (!body) continue;
      const inner = new Set<string>();
      snippetIdsIn(body, inner);
      for (const innerId of inner) {
        if (!used.has(innerId)) {
          used.add(innerId);
          grew = true;
        }
      }
    }
  }
  return used;
}

/**
 * Expand a raw change set into the per-screen changed list, against the
 * after-state screens + snippets (deleted screens exist only as their diff
 * entry — dependencies can't matter for a screen that's gone).
 */
export function detectChangedScreens(
  changes: DesignChangeSet,
  afterScreens: Map<string, Screen>,
  afterSnippets: Map<string, Snippet>,
): ChangedScreen[] {
  const out = new Map<string, ChangedScreen>();
  for (const [id, status] of changes.screens) {
    out.set(id, {
      id,
      status: status === "A" ? "added" : status === "D" ? "deleted" : "modified",
      reasons: ["screen"],
    });
  }

  const markModified = (id: string, reason: string): void => {
    const existing = out.get(id);
    if (existing) {
      // Direct add/delete wins; just record the extra reason.
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    out.set(id, { id, status: "modified", reasons: [reason] });
  };

  const needsDependencyScan =
    changes.global || changes.snippets.size > 0 || changes.assets.size > 0;
  if (needsDependencyScan) {
    for (const [id, screen] of afterScreens) {
      if (changes.global) markModified(id, "theme");
      if (changes.snippets.size === 0 && changes.assets.size === 0) continue;

      const used = snippetsUsedByScreen(screen, afterSnippets);
      for (const snippetId of changes.snippets) {
        if (used.has(snippetId)) markModified(id, `snippet:${snippetId}`);
      }
      if (changes.assets.size > 0) {
        let haystack = JSON.stringify(screen);
        for (const snippetId of used) {
          const body = afterSnippets.get(snippetId);
          if (body) haystack += JSON.stringify(body);
        }
        for (const asset of changes.assets) {
          if (haystack.includes(asset)) markModified(id, `asset:${asset}`);
        }
      }
    }
  }

  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------

export interface GitContext {
  repoRoot: string;
  /** Design folder path relative to the repo root ("" when it IS the root). */
  designRel: string;
  baseSha: string;
  headSha: string;
  /**
   * True when head resolves to the current HEAD — the after-state is then the
   * working tree (uncommitted changes included), and the diff runs one-ref
   * (base vs worktree) so detection matches what gets rendered.
   */
  headIsWorktree: boolean;
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Capture git's diagnostics instead of letting them reach the terminal:
    // `materializeRef` *expects* `git archive` to fail when the base ref
    // predates the design folder, and a raw `fatal: pathspec ...` there reads
    // as a crash. Closing stdin keeps a credential or editor prompt from
    // blocking a subprocess nobody is watching.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveGitContext(designFolder: string, base: string, head: string): GitContext {
  const repoRoot = git(designFolder, ["rev-parse", "--show-toplevel"]).trim();
  // realpath both sides: git prints physical paths, so a symlinked cwd
  // (macOS /tmp → /private/tmp) would otherwise look "outside the repo".
  const designRel = relative(realpathSync(repoRoot), realpathSync(resolve(designFolder)));
  if (designRel.startsWith("..")) {
    throw new Error(`design folder ${designFolder} is outside the git repo at ${repoRoot}`);
  }
  const rev = (ref: string): string => {
    try {
      return git(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
    } catch {
      throw new Error(`cannot resolve git ref '${ref}'`);
    }
  };
  const baseSha = rev(base);
  const headSha = rev(head);
  const currentSha = rev("HEAD");
  return { repoRoot, designRel, baseSha, headSha, headIsWorktree: headSha === currentSha };
}

/** `git diff --name-status` over the design folder, paths relative to it. */
export function diffDesignFolder(ctx: GitContext): RawChange[] {
  const args = ["diff", "--name-status", "--no-renames", ctx.baseSha];
  if (!ctx.headIsWorktree) args.push(ctx.headSha);
  if (ctx.designRel !== "") args.push("--", ctx.designRel);
  const output = git(ctx.repoRoot, args);
  const prefix = ctx.designRel === "" ? "" : `${ctx.designRel}/`;
  const out: RawChange[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const code = line.slice(0, tab).trim();
    const repoPath = line.slice(tab + 1);
    if (!repoPath.startsWith(prefix)) continue;
    // T (typechange) renders differently too — treat as modify.
    const status: GitFileStatus | null =
      code === "A" ? "A" : code === "D" ? "D" : code === "M" || code === "T" ? "M" : null;
    if (!status) continue;
    out.push({ status, path: repoPath.slice(prefix.length) });
  }
  return out;
}

export interface MaterializedRef {
  /** Temp root to clean up when done. */
  root: string;
  /** The design folder inside it. */
  designDir: string;
}

/**
 * Materialize a ref's design folder into a fresh temp dir (git archive → tar;
 * never touches the user's tree). Returns null when the ref has no design
 * folder (e.g. it was added after `base`). Caller owns cleanup of `root`.
 */
export async function materializeRef(
  ctx: GitContext,
  sha: string,
): Promise<MaterializedRef | null> {
  const root = await mkdtemp(join(tmpdir(), "velloo-ci-"));
  const tarPath = join(root, "snapshot.tar");
  const args = ["archive", "--format=tar", "-o", tarPath, sha];
  if (ctx.designRel !== "") args.push("--", ctx.designRel);
  try {
    git(ctx.repoRoot, args);
  } catch {
    await rm(root, { recursive: true, force: true });
    return null; // pathspec absent at that ref — no design folder to render from
  }
  execFileSync("tar", ["-xf", tarPath, "-C", root]);
  return { root, designDir: ctx.designRel === "" ? root : join(root, ctx.designRel) };
}
