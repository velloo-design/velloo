import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type Config, ConfigSchema } from "@velloo/schema";

/**
 * Walk up from `startPath` looking for a `.design/config.json`. Returns the
 * parsed config + the folder that contains it, or null when not found.
 */
export async function findDesignConfig(
  startPath: string,
): Promise<{ folder: string; config: Config } | null> {
  let dir = resolve(startPath);
  // If startPath is a file, begin from its parent directory.
  if (!dir.endsWith("/")) dir = dirname(dir);
  while (true) {
    const candidate = join(dir, ".design", "config.json");
    try {
      const raw = await readFile(candidate, "utf8");
      const config = ConfigSchema.parse(JSON.parse(raw));
      return { folder: dir, config };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
