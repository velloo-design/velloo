import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

/**
 * The repo-root manifest (`velloo.json`) names a repo's design folders so a
 * monorepo can hold several and commands can resolve them deterministically.
 * It is a pure pointer file — design settings stay in each folder's
 * `.design/config.json`; nothing here duplicates that contract.
 */
export const MANIFEST_FILE = "velloo.json";

const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    projects: z.record(
      z.string().regex(PROJECT_NAME, "project names are letters/digits plus . _ -"),
      z.string().min(1),
    ),
    defaultProject: z.string().optional(),
  })
  .refine((m) => !m.defaultProject || m.defaultProject in m.projects, {
    message: "defaultProject must name an entry in projects",
  });

export type Manifest = z.infer<typeof ManifestSchema>;

export interface FoundManifest {
  /** Absolute path of the velloo.json file. */
  path: string;
  /** Directory holding it — project paths resolve against this. */
  dir: string;
  manifest: Manifest;
  /** Project name → absolute design-folder path. */
  folders: Map<string, string>;
}

/**
 * Walk up from `startDir` for a `velloo.json`. A missing file keeps walking;
 * a present-but-broken one throws with the path — a typo'd manifest silently
 * falling back to convention would resolve the wrong folder.
 */
export async function findManifest(startDir: string): Promise<FoundManifest | null> {
  let dir = resolve(startDir);
  while (true) {
    const path = join(dir, MANIFEST_FILE);
    let raw: string | null = null;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
      }
      const result = ManifestSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new Error(`${path} is not a valid velloo manifest: ${issues}`);
      }
      const folders = new Map(
        Object.entries(result.data.projects).map(([name, rel]) => [name, resolve(dir, rel)]),
      );
      return { path, dir, manifest: result.data, folders };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Pick the project `cwd` implies, or null when only a human (or
 * defaultProject) can disambiguate. Containment beats everything: standing
 * inside a project's folder — or inside a directory that holds exactly one
 * project (an app dir in a monorepo) — is an unambiguous choice.
 */
export function pickProject(found: FoundManifest, cwd: string): string | null {
  const entries = [...found.folders];
  const containing = entries.find(([, folder]) => cwd === folder || cwd.startsWith(folder + sep));
  if (containing) return containing[0];
  const under = entries.filter(([, folder]) => folder.startsWith(cwd + sep));
  if (under.length === 1 && under[0]) return under[0][0];
  if (entries.length === 1 && entries[0]) return entries[0][0];
  return found.manifest.defaultProject ?? null;
}

/** Walk up from `start` for a `.git` entry (dir, or file for worktrees). */
async function findGitRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  while (true) {
    try {
      await stat(join(dir, ".git"));
      return dir;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function deriveName(folder: string): string {
  // `apps/web/velloo` should read as project "web", not "velloo" — the
  // default folder name says nothing about which app it designs.
  const base = basename(folder);
  const candidate = base === "velloo" || base === "." ? basename(dirname(folder)) : base;
  const sanitized = candidate
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "");
  return sanitized || "app";
}

export interface RegisterResult {
  name: string;
  /** Absolute path of the manifest that now lists the project. */
  path: string;
  /** False when the folder was already registered (no write happened). */
  created: boolean;
}

/**
 * Record a design folder as a project in the repo's `velloo.json` — an
 * existing manifest above the folder wins, else one is created at the git
 * root (or the app root outside a repo). Re-registering the same folder is a
 * no-op that keeps its existing name.
 */
export async function registerProject(
  folder: string,
  appRoot: string,
  requestedName?: string,
): Promise<RegisterResult> {
  if (requestedName && !PROJECT_NAME.test(requestedName)) {
    throw new Error(
      `invalid --project ${JSON.stringify(requestedName)} — names are letters/digits plus . _ -`,
    );
  }
  const abs = resolve(folder);
  const found = await findManifest(abs);
  const dir = found ? found.dir : ((await findGitRoot(appRoot)) ?? resolve(appRoot));
  const path = found ? found.path : join(dir, MANIFEST_FILE);

  const projects: Record<string, string> = { ...(found?.manifest.projects ?? {}) };
  for (const [existing, target] of found?.folders ?? []) {
    if (target === abs) return { name: existing, path, created: false };
  }

  let name = requestedName ?? deriveName(abs);
  for (let n = 2; name in projects; n++) name = `${requestedName ?? deriveName(abs)}-${n}`;
  projects[name] = relative(dir, abs) || ".";

  const manifest: Manifest = { ...(found?.manifest ?? {}), projects };
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { name, path, created: true };
}
