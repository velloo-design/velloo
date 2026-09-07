import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";
import { Hono } from "hono";
import { type DesignFolder, reloadDesignFolder } from "../design-folder.ts";
import { withBoardLock, withScreenLock, withSnippetLock } from "../mutations/context.ts";
import { withThemeLock } from "../theme/index.ts";
import type { WatchEvent } from "../watcher.ts";

type RevertFileStatus = "modified" | "added" | "deleted" | "untracked";

interface RevertFile {
  /** Path relative to the design folder. */
  path: string;
  status: RevertFileStatus;
}

interface RevertStatus {
  /** True when the folder is in a git repo with a HEAD and has changes to discard. */
  available: boolean;
  /** Why revert is unavailable (no repo, no commits, nothing to revert). */
  reason?: string;
  files: RevertFile[];
}

/**
 * Arg-array, no-shell git invocation — the same safe pattern as the CLI's
 * ci/diff.ts. `-C dir` keeps every command scoped to the design folder; the
 * `-- .` pathspec (relative to that cwd) is what confines status/restore/clean
 * to the folder even when it sits inside a larger repo.
 */
function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", dir, ...args],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout);
      },
    );
  });
}

function parseStatusCode(code: string): RevertFileStatus {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  return "modified";
}

async function revertStatus(folder: DesignFolder): Promise<RevertStatus> {
  let repoRoot: string;
  try {
    repoRoot = (await git(folder.root, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return {
      available: false,
      reason: "The design folder is not inside a git repository.",
      files: [],
    };
  }
  try {
    await git(folder.root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch {
    return {
      available: false,
      reason: "The repository has no commits to restore from.",
      files: [],
    };
  }
  // `git status` prints repo-root-relative paths; strip the folder's prefix so
  // the canvas shows paths the user recognizes. realpath both sides — git
  // prints physical paths (macOS /tmp → /private/tmp).
  const designRel = relative(realpathSync(repoRoot), realpathSync(folder.root));
  const prefix = designRel === "" ? "" : `${designRel}${sep}`;
  const out = await git(folder.root, ["status", "--porcelain", "--no-renames", "--", "."]);
  const files: RevertFile[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const code = line.slice(0, 2);
    const repoPath = line.slice(3);
    const path = repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
    files.push({ path, status: parseStatusCode(code) });
  }
  if (files.length === 0) {
    return { available: false, reason: "No uncommitted design changes to revert.", files };
  }
  return { available: true, files };
}

/**
 * Serialize the revert against every in-flight mutation: the per-object
 * promise-chain locks queue us behind whatever is running, and queue new
 * mutations behind us. Nesting distinct keys can't deadlock — each wrapper
 * just appends to that key's chain.
 */
function withAllLocks<T>(folder: DesignFolder, fn: () => Promise<T>): Promise<T> {
  let wrapped = fn;
  for (const id of folder.screens.keys()) {
    const inner = wrapped;
    wrapped = () => withScreenLock(folder, id, inner);
  }
  for (const id of folder.boards.keys()) {
    const inner = wrapped;
    wrapped = () => withBoardLock(folder, id, inner);
  }
  for (const id of folder.snippets.keys()) {
    const inner = wrapped;
    wrapped = () => withSnippetLock(folder, id, inner);
  }
  return withThemeLock(folder, wrapped);
}

/**
 * Git-backed revert-all: discard every uncommitted change in the
 * design folder in one action — the safety valve for agent sessions gone
 * wrong. Tracked modifications are restored to HEAD and untracked design
 * files removed, strictly scoped to the folder; `git clean` without `-x`
 * leaves gitignored runtime state (.design/cache/, .velloo/) untouched.
 */
export function createRevertRouter(
  folderFor: () => DesignFolder,
  broadcast: (e: WatchEvent) => void,
): Hono {
  const r = new Hono();

  r.get("/status", async (c) => c.json(await revertStatus(folderFor())));

  r.post("/", async (c) => {
    const folder = folderFor();
    const status = await revertStatus(folder);
    if (!status.available) {
      return c.json({ error: { code: "unavailable", message: status.reason } }, 409);
    }
    await withAllLocks(folder, async () => {
      await git(folder.root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", "."]);
      await git(folder.root, ["clean", "-fd", "--", "."]);
      // Every history snapshot now references pre-revert state — stale.
      folder.history.clear();
      await reloadDesignFolder(folder);
    });
    broadcast({ type: "folder-reloaded" });
    return c.json({ reverted: status.files.length, files: status.files });
  });

  return r;
}
