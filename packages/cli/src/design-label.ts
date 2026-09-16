import { basename, relative, resolve } from "node:path";
import { recordedDesignName } from "@velloo/server";
import { displayPath } from "./commands/init/output.ts";

/**
 * A design as a person identifies it on one line: its name and where its
 * folder is. The path is relative to the current directory when it sits inside
 * it, else `~`-shortened, so two designs named alike still tell apart.
 */
export function designWithFolder(folder: string, name?: string | undefined): string {
  const shown = name ?? recordedDesignName(folder) ?? basename(folder);
  const rel = relative(resolve("."), folder);
  const where = rel !== "" && !rel.startsWith("..") ? `./${rel}` : displayPath(folder);
  return `"${shown}" (${where})`;
}
