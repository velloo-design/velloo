import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type Look, LookSchema } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";

/**
 * A Look's sidecar file, kept in step with its theme: written, moved and
 * removed only from inside the theme lock, so a theme and its Look never part.
 */

const lookFile = (folder: Pick<DesignFolder, "root">, name: string) =>
  join(folder.root, "looks", `${name}.json`);

export async function persistLook(folder: DesignFolder, name: string, look: Look): Promise<Look> {
  const validated = LookSchema.parse({ ...look, updatedAt: new Date().toISOString() });
  await writeJsonAtomic(lookFile(folder, name), validated);
  folder.looks.set(name, validated);
  return validated;
}

/** Follow a theme rename. "night" → "Night" is one file on a disk that ignores case. */
export async function moveLook(folder: DesignFolder, from: string, to: string): Promise<void> {
  const look = folder.looks.get(from);
  if (!look) return;
  if (from.toLowerCase() === to.toLowerCase()) {
    await rename(lookFile(folder, from), lookFile(folder, to));
  } else {
    await writeJsonAtomic(lookFile(folder, to), look);
    await rm(lookFile(folder, from), { force: true });
  }
  folder.looks.delete(from);
  folder.looks.set(to, look);
}

export async function dropLook(folder: DesignFolder, name: string): Promise<void> {
  await rm(lookFile(folder, name), { force: true });
  folder.looks.delete(name);
}
