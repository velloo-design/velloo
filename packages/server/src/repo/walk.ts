import { readdir } from "node:fs/promises";
import { join } from "node:path";

const PRUNED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".git",
]);

/**
 * Files under `root` whose name matches `test`, never descending into
 * dependencies, build output or dot-directories — a glob over `**` would walk
 * `node_modules` first and only then filter, which costs seconds on a real app.
 */
export async function findFiles(
  root: string,
  test: (name: string) => boolean,
  limit = 2000,
): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith(".") || PRUNED.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && test(entry.name)) out.push(full);
    }
  };
  await visit(root);
  return out;
}
