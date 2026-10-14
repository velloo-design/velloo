import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "public"]);
const MAX_FILES = 600;
const MAX_DEPTH = 5;
const MAX_BYTES = 256 * 1024;

/**
 * The first of an app's modules whose source `accepts`, shallowest first and
 * in name order within a directory. A theme has no canonical place (a Vite app
 * keeps it in `main.tsx`, a Next one in `theme.ts` beside the layout), so this
 * is a bounded walk: so many files, so deep, none too large. A directory with
 * a package.json of its own is another package — a workspace beside the app —
 * and is not entered. Side-effect-free.
 */
export function findModule(appRoot: string, accepts: (src: string) => boolean): string | undefined {
  let read = 0;
  let level = [appRoot];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0 && read < MAX_FILES; depth++) {
    const below: string[] = [];
    for (const dir of level) {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            !entry.name.startsWith(".") &&
            !SKIP_DIRS.has(entry.name) &&
            !existsSync(join(path, "package.json"))
          )
            below.push(path);
          continue;
        }
        if (!/\.(?:[cm]?[jt]sx?)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
        if (read >= MAX_FILES) break;
        let src: string;
        try {
          if (statSync(path).size > MAX_BYTES) continue;
          src = readFileSync(path, "utf8");
        } catch {
          continue;
        }
        read++;
        if (accepts(src)) return path;
      }
    }
    level = below;
  }
  return undefined;
}
