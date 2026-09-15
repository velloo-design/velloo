import { resolve, sep } from "node:path";
import { hasDesignConfig, resolveDesignFolder } from "./folder.ts";
import { findProjects } from "./manifest.ts";

export interface RunTarget {
  /** Project name, when the folder is registered. */
  name: string | undefined;
  folder: string;
}

/**
 * Which folders `velloo run` should start.
 *
 * An explicit argument always means exactly one folder — naming a project or
 * a path is how you say "just this one". Bare `velloo run` in a checkout with
 * several projects (its `velloo.json` entries plus its local designs) starts
 * them all, because a repo's design folders are siblings of one work session,
 * and only starting one of them silently hides the rest. Standing inside a
 * design folder still wins: you cd'd there, so that's the one you meant.
 */
export async function resolveRunTargets(
  arg: string | undefined,
  opts: { cwd?: string | undefined } = {},
): Promise<RunTarget[]> {
  const cwd = resolve(opts.cwd ?? ".");
  const single = async (): Promise<RunTarget[]> => {
    const folder = await resolveDesignFolder(arg, "run", {
      interactive: true,
      requireConfig: true,
      cwd,
    });
    return [{ name: await projectNameFor(folder, cwd), folder }];
  };
  if (arg) return single();

  let found: Awaited<ReturnType<typeof findProjects>>;
  try {
    found = await findProjects(cwd);
  } catch {
    return single(); // a broken manifest is resolveDesignFolder's error to report
  }
  if (!found || found.folders.size < 2) return single();
  // Inside one of the projects ⇒ that one.
  for (const [name, folder] of found.folders) {
    if (cwd === folder || cwd.startsWith(folder + sep)) return [{ name, folder }];
  }

  const targets: RunTarget[] = [];
  for (const [name, folder] of found.folders) {
    if (await hasDesignConfig(folder))
      targets.push({
        name,
        folder: await resolveDesignFolder(name, "run", { cwd, requireConfig: true }),
      });
  }
  // A manifest full of stale paths shouldn't silently start nothing — fall
  // back to the single-folder resolver so the user gets its diagnostics.
  if (targets.length === 0) return single();
  if (targets.length === 1) return targets;

  // The default project leads, so `--open` and `o` hit the expected canvas.
  const defaultProject = found.defaultProject;
  if (defaultProject) {
    targets.sort((a, b) => (a.name === defaultProject ? -1 : b.name === defaultProject ? 1 : 0));
  }
  return targets;
}

async function projectNameFor(folder: string, cwd: string): Promise<string | undefined> {
  try {
    const found = await findProjects(cwd);
    if (!found) return undefined;
    for (const [name, path] of found.folders) if (path === folder) return name;
  } catch {
    // display-only
  }
  return undefined;
}
