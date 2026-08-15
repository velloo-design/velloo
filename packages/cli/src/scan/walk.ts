import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Async generator yielding every regular file under `root` (recursive).
 * Skips `node_modules/`, dotfiles, and `dist/` / `.next/` build output
 * directories. Order is deterministic (alphabetical per directory) so
 * the generated screen list is stable across machines.
 */
export async function* walkFiles(root: string): AsyncGenerator<string> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  entries.sort((a, b) => a.localeCompare(b));
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (name === "node_modules" || name === "dist" || name === ".next") continue;
    const full = join(root, name);
    const s = await stat(full).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) {
      yield* walkFiles(full);
    } else if (s.isFile()) {
      yield full;
    }
  }
}

export async function dirExists(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null);
  return s?.isDirectory() ?? false;
}

export async function fileExists(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null);
  return s?.isFile() ?? false;
}
