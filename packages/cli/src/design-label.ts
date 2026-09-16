import { basename, relative, resolve } from "node:path";
import { recordedDesignName } from "@velloo/server";
import { displayPath } from "./commands/init/output.ts";

/**
 * A design as a person identifies it on one line: its name and where its
 * folder is, so two designs named alike still tell apart. The path is relative
 * to the current directory when it sits inside it, else `~`-shortened.
 * `absolute` always uses the `~` form, for lists of canvases from anywhere on
 * the machine, which would otherwise mix the two styles line by line.
 */
export function designWithFolder(
  folder: string,
  name?: string | undefined,
  opts: { absolute?: boolean } = {},
): string {
  const shown = name ?? recordedDesignName(folder) ?? basename(folder);
  const rel = relative(resolve("."), folder);
  const inside = rel !== "" && !rel.startsWith("..");
  const where = inside && !opts.absolute ? `./${rel}` : displayPath(folder);
  return `"${shown}" (${where})`;
}
