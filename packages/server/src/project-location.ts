import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { type RepoManifest, RepoManifestSchema } from "@velloo/schema";
import { z } from "zod";
import { writeJsonAtomic } from "./fs.ts";

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const BindingSchema = z.object({
  manifestPath: z.string().min(1),
  appRoot: z.string().min(1),
  projectName: z.string().min(1),
});
export type ProjectContext = z.infer<typeof BindingSchema>;

function storageRoot(): string {
  return resolve(process.env.VELLOO_DESIGNS_HOME ?? join(homedir(), ".velloo", "designs"));
}

/** Identifiers never contain a path. A manifest cannot choose where we write. */
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

function bindingPath(id: string): string {
  managedDesignPath(id);
  return join(storageRoot(), ".locations", `${id}.json`);
}

export function managedDesignId(folder: string): string | null {
  const abs = resolve(folder);
  const parent = dirname(abs);
  const root = storageRoot();
  if (
    parent !== root &&
    (!existsSync(parent) || !existsSync(root) || realpathSync(parent) !== realpathSync(root))
  )
    return null;
  const id = basename(abs);
  if (!ID.test(id)) return null;
  managedDesignPath(id);
  return id;
}

export function readManagedBinding(id: string): ProjectContext {
  const path = bindingPath(id);
  try {
    return BindingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(
      `Missing or malformed local mapping ${path}. Restore the design under ${managedDesignPath(id)}, then run \`velloo folder bind <project> --yes\` from its application repository. ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function writeManagedBinding(id: string, context: ProjectContext): Promise<void> {
  try {
    await writeJsonAtomic(bindingPath(id), BindingSchema.parse(context));
  } catch (error) {
    throw new Error(
      `Could not save the local binding for ${id}. Check write permissions and free space in ${storageRoot()}, then retry. Design content was retained. ${error instanceof Error ? error.message : error}`,
    );
  }
}

/** Binding is local authority; a clone with the same id cannot claim another app's design. */
export function managedProjectContext(folder: string): ProjectContext | null {
  const id = managedDesignId(folder);
  if (!id) return null;
  const context = readManagedBinding(id);
  let manifest: RepoManifest;
  try {
    manifest = RepoManifestSchema.parse(JSON.parse(readFileSync(context.manifestPath, "utf8")));
  } catch {
    throw new Error(
      `Application manifest ${context.manifestPath} is missing or malformed. Restore it or run \`velloo folder bind <project> --yes\` from the moved application.`,
    );
  }
  const entry = manifest.projects[context.projectName];
  if (
    !entry ||
    typeof entry === "string" ||
    entry.managed !== id ||
    resolve(context.appRoot) !== resolve(dirname(context.manifestPath), entry.appRoot ?? ".")
  ) {
    throw new Error(
      `Stale local mapping for ${folder}: ${context.manifestPath} no longer registers ${context.projectName}. Restore the registration or explicitly bind the project.`,
    );
  }
  if (!existsSync(context.appRoot))
    throw new Error(
      `Application root ${context.appRoot} is missing. Move or restore the application, then bind its project again.`,
    );
  return context;
}

/** `project:` paths are portable references into the locally bound application. */
export function resolveProjectPath(folder: string, path: string): string {
  if (!path.startsWith("project:")) return resolve(folder, path);
  const context = managedProjectContext(folder);
  if (!context)
    throw new Error(
      `Project-relative reference ${path} has no application binding for ${folder}. Run velloo folder bind from the application repository.`,
    );
  const rel = path.slice("project:".length);
  if (/^(?:[\\/]|[A-Za-z]:)/.test(rel)) throw new Error(`Invalid project-relative path: ${path}`);
  return resolve(context.appRoot, rel.replace(/\\/g, "/"));
}
