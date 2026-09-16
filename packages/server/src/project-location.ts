import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { APP_PATH_PREFIX } from "@velloo/schema";
import { z } from "zod";
import { writeJsonAtomic } from "./fs.ts";

/**
 * Local designs: design folders that live outside the checkout they design
 * for — in Velloo's managed storage or at a path the user chose. They are
 * deliberately absent from the committed `velloo.json`: the location means
 * nothing to anyone else, and a repository must not be able to point Velloo
 * at a directory outside itself. The only authority for "this checkout has a
 * design over there" is a record on this machine, under
 * `<storage>/.locations/<id>.json`, written by `init`, `relocate` or `bind`.
 */

const ID = /^[A-Za-z0-9_-]{8,64}$/;

const RecordSchema = z.object({
  /** The checkout the design belongs to — where commands and agents run. */
  root: z.string().min(1),
  /** The application inside `root` the design targets. */
  appRoot: z.string().min(1),
  /**
   * The design's name, from before names moved into its config. Read so a
   * design not yet upgraded keeps resolving; never written.
   */
  projectName: z.string().optional(),
  /** A folder the user chose; absent means managed storage (`<storage>/<id>`). */
  designPath: z.string().min(1).optional(),
});
type LocalDesignRecord = Omit<z.infer<typeof RecordSchema>, "projectName">;

export interface LocalDesign {
  id: string;
  root: string;
  appRoot: string;
  /** The pre-v4 name this record carried, for a design not yet upgraded. */
  legacyName: string | undefined;
  /** Absolute design folder. */
  designRoot: string;
}

function storageRoot(): string {
  return resolve(process.env.VELLOO_DESIGNS_HOME ?? join(homedir(), ".velloo", "designs"));
}

function locationsDir(): string {
  return join(storageRoot(), ".locations");
}

function realOr(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

/** Where managed storage keeps a design. Identifiers never contain a path. */
export function managedDesignPath(id: string): string {
  if (!ID.test(id)) throw new Error(`Invalid managed design identifier: ${JSON.stringify(id)}`);
  const folder = join(storageRoot(), id);
  if (lstatSync(folder, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(
      `Managed design ${folder} is a symbolic link. Restore the actual folder here before opening it.`,
    );
  }
  return folder;
}

/** The id of a folder sitting directly in managed storage, registered or not. */
export function managedDesignId(folder: string): string | null {
  const abs = resolve(folder);
  if (realOr(dirname(abs)) !== realOr(storageRoot())) return null;
  const id = basename(abs);
  return ID.test(id) ? id : null;
}

/**
 * The record shape development builds wrote between 2026-09-09 and 2026-09-15:
 * the checkout was named by its manifest's path. Never shipped in a release;
 * {@link listLocalDesigns} rewrites it in the current shape the first time it
 * reads one, so it can go once those builds are gone.
 */
const DevRecordSchema = z.object({
  manifestPath: z.string().min(1),
  appRoot: z.string().min(1),
  projectName: z.string().optional(),
});

function readRecord(path: string): z.infer<typeof RecordSchema> {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const current = RecordSchema.safeParse(raw);
  if (current.success) return current.data;
  const dev = DevRecordSchema.parse(raw);
  const migrated = RecordSchema.parse({
    root: dirname(resolve(dev.manifestPath)),
    appRoot: resolve(dev.appRoot),
    ...(dev.projectName ? { projectName: dev.projectName } : {}),
  });
  // Best effort: an unwritable record still resolves from the migrated copy.
  void writeJsonAtomic(path, migrated).catch(() => {});
  return migrated;
}

/** Every local design recorded on this machine; unreadable records are skipped. */
export function listLocalDesigns(): LocalDesign[] {
  let names: string[];
  try {
    names = readdirSync(locationsDir()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const out: LocalDesign[] = [];
  for (const name of names.sort()) {
    const id = name.slice(0, -".json".length);
    if (!ID.test(id)) continue;
    try {
      const record = readRecord(join(locationsDir(), name));
      out.push({
        id,
        root: record.root,
        appRoot: record.appRoot,
        legacyName: record.projectName,
        designRoot: record.designPath ?? managedDesignPath(id),
      });
    } catch {
      // A record from an older format or a hand edit: `design bind` rewrites it.
    }
  }
  return out;
}

/**
 * Local designs recorded for the project at exactly `dir`. A design recorded
 * for a parent directory belongs to that project, not to every folder under it.
 */
export function localDesignsAt(dir: string): LocalDesign[] {
  const here = realOr(dir);
  return listLocalDesigns().filter((design) => realOr(design.root) === here);
}

/** The record for a design folder, when it is a local design on this machine. */
export function localDesignOf(folder: string): LocalDesign | null {
  const target = realOr(folder);
  return listLocalDesigns().find((design) => realOr(design.designRoot) === target) ?? null;
}

export async function writeLocalDesign(id: string, record: LocalDesignRecord): Promise<void> {
  if (!ID.test(id)) throw new Error(`Invalid local design identifier: ${JSON.stringify(id)}`);
  try {
    await writeJsonAtomic(
      join(locationsDir(), `${id}.json`),
      RecordSchema.parse({
        root: resolve(record.root),
        appRoot: resolve(record.appRoot),
        ...(record.designPath ? { designPath: resolve(record.designPath) } : {}),
      }),
    );
  } catch (error) {
    throw new Error(
      `Could not save the local design record ${id}. Check write permissions and free space in ${storageRoot()}, then retry. Design content was retained. ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function removeLocalDesign(id: string): Promise<void> {
  if (!ID.test(id)) return;
  await rm(join(locationsDir(), `${id}.json`), { force: true });
}

/**
 * Resolve a config path from its design folder. `app:` paths are portable
 * references into the design's application, which only this machine's record
 * of a local design can place.
 */
export function resolveAppPath(folder: string, path: string): string {
  if (!path.startsWith(APP_PATH_PREFIX)) return resolve(folder, path);
  const design = localDesignOf(folder);
  if (!design)
    throw new Error(
      `App-relative reference ${path} has no application on this machine for ${folder}. Run \`velloo design bind ${folder}\` from the application checkout.`,
    );
  const rel = path.slice(APP_PATH_PREFIX.length);
  if (/^(?:[\\/]|[A-Za-z]:)/.test(rel)) throw new Error(`Invalid app-relative path: ${path}`);
  return resolve(design.appRoot, rel.replace(/\\/g, "/"));
}
