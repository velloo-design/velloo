import { access } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { managedProjectContext } from "@velloo/server";

/**
 * Where to write the agent config. An explicit override wins; otherwise
 * walk up from the design folder for the nearest `package.json` (the host
 * app / monorepo root, where an agent is typically opened), falling back
 * to the design folder's parent when there's no package.json anywhere
 * above (a standalone design repo).
 */
export async function resolveProjectRoot(designFolder: string, override?: string): Promise<string> {
  if (override) return override;
  const managed = managedProjectContext(designFolder);
  if (managed) return managed.appRoot;

  const fallback = dirname(designFolder);
  let dir = fallback;
  const fsRoot = parse(dir).root;
  for (let i = 0; i < 8; i++) {
    try {
      await access(join(dir, "package.json"));
      return dir;
    } catch {
      // No package.json here — keep walking up.
    }
    if (dir === fsRoot) break;
    dir = dirname(dir);
  }
  return fallback;
}
