import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

/**
 * A session started in a terminal or a desktop app may have run in any
 * directory of the app's checkout — the repository root above the app, a
 * package beside it, a worktree — and a provider resumes it only from there.
 * These say which directories count as this app's.
 */

/** A path as the filesystem resolves it: `/var` and `/private/var` are one directory. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The checkout a directory is in: the nearest ancestor holding `.git`, else the directory. */
export function checkoutRoot(cwd: string): string {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return cwd;
  }
}

export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Whether a session that ran in `where` can be continued from `cwd`'s checkout. */
export function inCheckout(cwd: string, where: string): boolean {
  return isAbsolute(where) && existsSync(where) && within(real(checkoutRoot(cwd)), real(where));
}

/** Where a listed session ran, relative to the checkout, when it isn't `cwd` itself. */
export function whereFrom(cwd: string, where: string): { where?: string } {
  if (real(where) === real(cwd)) return {};
  return { where: relative(real(checkoutRoot(cwd)), real(where)) || "." };
}
