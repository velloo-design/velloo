import { resolve } from "node:path";
import { recordedDesignName } from "@velloo/server";
import { resolveDesign } from "./design.ts";
import { findDesigns } from "./manifest.ts";

export interface RunTarget {
  /** The design's name, when its config records one. */
  name: string | undefined;
  folder: string;
}

/**
 * Which folders `velloo run` should start.
 *
 * An explicit argument always means exactly one folder — naming a design or
 * a path is how you say "just this one". Bare `velloo run` in a checkout with
 * several designs (its `velloo.json` entries plus its local designs) starts
 * them all, because a repo's design folders are siblings of one work session,
 * and only starting one of them silently hides the rest. Only the directory
 * the command runs in is read: a velloo.json above it is another project.
 */
export async function resolveRunTargets(
  arg: string | undefined,
  opts: { cwd?: string | undefined } = {},
): Promise<RunTarget[]> {
  const cwd = resolve(opts.cwd ?? ".");
  const single = async (): Promise<RunTarget[]> => {
    const folder = await resolveDesign(arg, "run", {
      interactive: true,
      requireConfig: true,
      cwd,
    });
    return [{ name: recordedDesignName(folder) ?? undefined, folder }];
  };
  if (arg) return single();

  let found: Awaited<ReturnType<typeof findDesigns>>;
  try {
    found = await findDesigns(cwd);
  } catch {
    return single(); // a broken manifest is resolveDesign's error to report
  }
  if (!found || found.designs.length < 2) return single();

  const targets: RunTarget[] = [];
  for (const design of found.designs) {
    if (design.exists && !design.outsideRepo)
      targets.push({ name: design.name, folder: design.root });
  }
  // A manifest full of stale paths shouldn't silently start nothing — fall
  // back to the single-folder resolver so the user gets its diagnostics.
  if (targets.length === 0) return single();
  if (targets.length === 1) return targets;

  // The default design leads, so `--open` and `o` hit the expected canvas.
  const defaultDesign = found.defaultDesign;
  if (defaultDesign) {
    targets.sort((a, b) => (a.name === defaultDesign ? -1 : b.name === defaultDesign ? 1 : 0));
  }
  return targets;
}
