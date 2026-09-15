import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { ConfigSchema, type RepoManifest } from "@velloo/schema";
import {
  hostAppRootFrom,
  loadDesignFolder,
  managedDesignId,
  managedDesignPath,
  removeLocalDesign,
  resolveProjectPath,
  writeJsonAtomic,
  writeLocalDesign,
} from "@velloo/server";
import { daemonRoot, stopDaemon } from "./daemon/runtime.ts";
import { findProjects, isWithin } from "./manifest.ts";

function physicalDestination(path: string): string {
  if (lstatSync(path, { throwIfNoEntry: false })) return realpathSync(path);
  const parent = dirname(path);
  return join(physicalDestination(parent), relative(parent, path));
}

const RUNTIME = [".design/cache", ".velloo", "node_modules"];

/** Rebase just filesystem references; every design object and identity stays intact. */
export async function rebaseDesignConfig(
  source: string,
  destination: string,
  appRoot: string,
  external: boolean,
): Promise<void> {
  const config = ConfigSchema.parse(
    JSON.parse(await readFile(join(destination, ".design/config.json"), "utf8")),
  );
  const rebase = (path: string) => {
    if (path === "binary" || path.startsWith("~/")) return path;
    const abs = resolveProjectPath(source, path);
    const withinDesign = relative(source, abs);
    if (
      withinDesign === "" ||
      (withinDesign !== ".." &&
        !withinDesign.startsWith(`..${sep}`) &&
        !/^(?:[\\/]|[A-Za-z]:)/.test(withinDesign))
    )
      return withinDesign.split(sep).join("/") || ".";
    return external
      ? `project:${relative(appRoot, abs).split(sep).join("/") || "."}`
      : relative(destination, abs).split(sep).join("/") || ".";
  };
  config.hostApp = config.hostApp
    ? { ...config.hostApp, root: rebase(config.hostApp.root) }
    : { root: rebase("..") };
  for (const app of Object.values(config.hostApps ?? {})) app.root = rebase(app.root);
  for (const library of Object.values(config.libraries)) {
    if (library.componentsPath) library.componentsPath = rebase(library.componentsPath);
  }
  await writeJsonAtomic(join(destination, ".design/config.json"), config);
}

async function fingerprint(folder: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(rel: string): Promise<void> {
    if (rel === ".git" || RUNTIME.some((p) => rel === p || rel.startsWith(`${p}/`))) return;
    const path = join(folder, rel);
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error(
        `Cannot relocate symbolic link ${path}. Replace it with its actual design content first.`,
      );
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(rel ? `${rel}/${name}` : name);
    } else if (stat.isFile()) {
      hash
        .update(rel)
        .update("\0")
        .update(await readFile(path));
    } else throw new Error(`Unsupported filesystem entry: ${path}`);
  }
  await walk("");
  return hash.digest("hex");
}

export interface RelocationPlan {
  source: string;
  destination: string;
  /** The checkout the design belongs to. */
  root: string;
  appRoot: string;
  projectName: string;
  /** The source's local design record, when it is one. */
  sourceLocalId?: string | undefined;
  /** Where the destination is recorded: a local design, or (absent) velloo.json. */
  destinationLocal?: { id: string; designPath?: string | undefined } | undefined;
  manifestPath: string;
  /** The manifest as read, or null when there is none — checked before writing. */
  before: string | null;
  /** The manifest to write; null removes the file, undefined leaves it alone. */
  manifest: RepoManifest | null | undefined;
}

/**
 * Plan moving a design between the repository, managed storage (`external`)
 * and a chosen directory (`to`, inside or outside the repository). Inside the
 * repository a design is a `velloo.json` entry; anywhere else it is a local
 * design recorded only on this machine.
 */
export async function planRelocation(
  source: string,
  cwd: string,
  to: string | undefined,
  external: boolean,
): Promise<RelocationPlan> {
  if (Boolean(to) === external)
    throw new Error("Choose exactly one destination: --external or --to <path>.");
  const projects = await findProjects(cwd);
  const physicalSource = realpathSync(source);
  const local = projects?.local.find((design) => realOr(design.designRoot) === physicalSource);
  const entries = [...(projects?.repo?.folders ?? [])].filter(
    ([, path]) => existsSync(path) && realpathSync(path) === physicalSource,
  );
  if (!local && entries.length !== 1)
    throw new Error(
      "Run relocation from the checkout the design belongs to; the source must be one of its projects.",
    );
  const repo = projects?.repo ?? null;
  const root = local?.root ?? (repo?.dir as string);
  const name = local?.projectName ?? (entries[0]?.[0] as string);
  const physicalRoot = realpathSync(root);
  if (physicalSource === physicalRoot)
    throw new Error(
      "Cannot relocate the application repository itself. Use a separate design directory.",
    );
  if (external && managedDesignId(source))
    throw new Error("This design already lives in managed storage.");

  const destination = external
    ? managedDesignPath(local?.id ?? randomUUID())
    : resolve(cwd, to ?? "");
  const physicalTarget = physicalDestination(destination);
  const inRepo = !external && isWithin(physicalRoot, physicalTarget);
  if (
    physicalTarget === physicalSource ||
    physicalTarget.startsWith(physicalSource + sep) ||
    physicalSource.startsWith(physicalTarget + sep)
  )
    throw new Error("Source and destination cannot contain each other.");
  if (existsSync(destination))
    throw new Error(
      `Destination is occupied: ${destination}. Choose a new path; nothing was changed.`,
    );

  const manifestPath = repo?.path ?? join(root, "velloo.json");
  const before = repo ? await readFile(repo.path, "utf8") : null;
  let manifest: RepoManifest | null | undefined;
  if (inRepo) {
    const rel = relative(physicalRoot, physicalTarget).split(sep).join("/") || ".";
    manifest = {
      ...(repo?.manifest ?? {}),
      projects: { ...(repo?.manifest.projects ?? {}), [name]: rel },
    };
  } else if (repo && name in repo.manifest.projects) {
    const { [name]: _moved, ...rest } = repo.manifest.projects;
    const { defaultProject, ...others } = repo.manifest;
    manifest =
      Object.keys(rest).length === 0 && !others.feedback
        ? null
        : {
            ...others,
            projects: rest,
            ...(defaultProject && defaultProject !== name ? { defaultProject } : {}),
          };
  }
  const config = ConfigSchema.parse(
    JSON.parse(await readFile(join(source, ".design/config.json"), "utf8")),
  );
  return {
    source,
    destination,
    root,
    appRoot: local?.appRoot ?? hostAppRootFrom(source, config.hostApp),
    projectName: name,
    sourceLocalId: local?.id,
    destinationLocal: inRepo
      ? undefined
      : {
          id: local?.id ?? (external ? basename(destination) : randomUUID()),
          ...(external ? {} : { designPath: destination }),
        },
    manifestPath,
    before,
    manifest,
  };
}

function realOr(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

export async function relocateDesign(plan: RelocationPlan): Promise<void> {
  await stopDaemon(daemonRoot(plan.source));
  const original = await fingerprint(plan.source);
  await mkdir(dirname(plan.destination), { recursive: true });
  await mkdir(plan.destination); // Exclusive ownership: never clean up somebody else's destination.
  let committed = false;
  try {
    for (const entry of await readdir(plan.source))
      await cp(join(plan.source, entry), join(plan.destination, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: (path) =>
          !RUNTIME.some((p) => {
            const rel = relative(plan.source, path).split(sep).join("/");
            return rel === p || rel.startsWith(`${p}/`);
          }),
      });
    if ((await fingerprint(plan.destination)) !== original)
      throw new Error("Copied content did not match the source.");
    await rebaseDesignConfig(
      plan.source,
      plan.destination,
      plan.appRoot,
      plan.destinationLocal !== undefined,
    );
    await loadDesignFolder(plan.destination, { preferences: false });
    if ((await fingerprint(plan.source)) !== original)
      throw new Error("The source changed during relocation. Close editors and retry.");
    const current = await readFile(plan.manifestPath, "utf8").catch(() => null);
    if (current !== plan.before)
      throw new Error("The manifest changed during relocation. Review it and retry.");
    if (plan.destinationLocal) {
      if (plan.sourceLocalId && plan.sourceLocalId !== plan.destinationLocal.id)
        await removeLocalDesign(plan.sourceLocalId);
      await writeLocalDesign(plan.destinationLocal.id, {
        root: plan.root,
        appRoot: plan.appRoot,
        projectName: plan.projectName,
        ...(plan.destinationLocal.designPath
          ? { designPath: plan.destinationLocal.designPath }
          : {}),
      });
    } else if (plan.sourceLocalId) {
      await removeLocalDesign(plan.sourceLocalId);
    }
    if (plan.manifest === null) await rm(plan.manifestPath, { force: true });
    else if (plan.manifest) await writeJsonAtomic(plan.manifestPath, plan.manifest);
    committed = true;
  } finally {
    if (!committed) await rm(plan.destination, { recursive: true, force: true });
  }
  // After the pointer commits, a cleanup error leaves both copies recoverable.
  try {
    await rm(plan.source, { recursive: true });
  } catch (error) {
    throw new Error(
      `Relocation completed to ${plan.destination}, but the old copy remains at ${plan.source}. Remove it after checking the destination. ${error}`,
    );
  }
}
