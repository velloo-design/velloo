import { readFile } from "node:fs/promises";
import { createPatch } from "diff";

export interface FileDiff {
  /** Whether a file already exists at the path. */
  exists: boolean;
  /** Unified diff between existing contents (or "" if new) and the new contents. */
  diff: string;
  /** True when on-disk contents already equal the new contents. */
  identical: boolean;
  path: string;
}

export async function diffFile(path: string, next: string): Promise<FileDiff> {
  let current = "";
  let exists = false;
  try {
    current = await readFile(path, "utf8");
    exists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (current === next) return { exists, diff: "", identical: true, path };

  const fromLabel = exists ? `${path} (current)` : `${path} (new file)`;
  const diff = createPatch(path, current, next, fromLabel, `${path} (proposed)`);
  return { exists, diff, identical: false, path };
}

/** Colorize a unified diff for terminal display. */
export function colorizeDiff(diff: string): string {
  // ANSI: 31 red, 32 green, 36 cyan, 0 reset.
  const lines = diff.split("\n").map((line) => {
    if (line.startsWith("+++") || line.startsWith("---")) return `\x1b[36m${line}\x1b[0m`;
    if (line.startsWith("@@")) return `\x1b[36m${line}\x1b[0m`;
    if (line.startsWith("+")) return `\x1b[32m${line}\x1b[0m`;
    if (line.startsWith("-")) return `\x1b[31m${line}\x1b[0m`;
    return line;
  });
  return lines.join("\n");
}
