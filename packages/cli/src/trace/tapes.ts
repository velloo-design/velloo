import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where the recorder writes tapes, relative to a design folder root. */
export const TRACE_SUBDIR = join(".velloo", "trace");

function isTapeDir(dir: string): boolean {
  return existsSync(join(dir, "tape.jsonl"));
}

/** Tape dirs under `root`, newest first. Accepts a single tape dir directly. */
export function findTapes(root: string): string[] {
  if (isTapeDir(root)) return [root];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .map((e) => join(root, e))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && isTapeDir(p);
      } catch {
        return false;
      }
    })
    .sort() // tape ids are timestamp-prefixed, so lexical order is chronological
    .reverse();
}

/** The most recent tape under `root`, or null when none exist yet. */
export function newestTape(root: string): string | null {
  return findTapes(root)[0] ?? null;
}
