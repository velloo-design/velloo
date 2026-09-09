import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ConfigSchema, type RepoManifest } from "@velloo/schema";
import {
  loadDesignFolder,
  managedDesignId,
  managedDesignPath,
  managedProjectContext,
  resolveProjectPath,
  writeJsonAtomic,
  writeManagedBinding,
} from "@velloo/server";
import { daemonRoot, stopDaemon } from "./daemon/runtime.ts";
import { findManifest } from "./manifest.ts";

function physicalDestination(path: string): string {
  if (lstatSync(path, { throwIfNoEntry: false })) return realpathSync(path);
  const parent = dirname(path);
  return join(physicalDestination(parent), relative(parent, path));
}

const RUNTIME = [".design/cache", ".velloo", "node_modules"];

function git(folder: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", folder, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(
      `Git operation failed in ${folder}. Install Git and check repository permissions and identity, then retry. Design files were retained. ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function checkpoint(
  folder: string,
  message: string,
  initialize = false,
): Promise<string> {
  if (!message.trim()) throw new Error("A checkpoint needs a non-empty message (--message).");
  await loadDesignFolder(folder, { preferences: false });
  const gitEntry = await lstat(join(folder, ".git")).catch(() => null);
  if (gitEntry && !gitEntry.isDirectory())
    throw new Error(
      "Standalone design history must have its own .git directory, not a linked worktree or symlink.",
    );
  if (initialize) {
    git(folder, ["init", "--initial-branch=main"]);
    const path = join(folder, ".gitignore");
    const existing = await readFile(path, "utf8").catch(() => "");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path,
      `${existing}\n# Machine-only Velloo state\n/.design/cache/\n/.velloo/\n/node_modules/\n.DS_Store\n`,
    );
  }
  if (!existsSync(join(folder, ".git")))
    throw new Error(`No standalone Git history in ${folder}. Relocate it with --external first.`);
  git(folder, ["add", "--all", "--", "."]);
  const identity = git(folder, ["config", "--list"]).split("\n");
  const defaults = [
    ...(identity.some((s) => s.startsWith("user.name=")) ? [] : ["-c", "user.name=Velloo"]),
    ...(identity.some((s) => s.startsWith("user.email="))
      ? []
      : ["-c", "user.email=design@velloo.local"]),
  ];
  git(folder, [...defaults, "commit", "--allow-empty", "-m", message]);
  return git(folder, ["rev-parse", "HEAD"]);
}

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
  appRoot: string;
  manifestPath: string;
  projectName: string;
  managedId?: string;
  before: string;
  manifest: RepoManifest;
}

export async function planRelocation(
  source: string,
  cwd: string,
  to: string | undefined,
  external: boolean,
): Promise<RelocationPlan> {
  if (Boolean(to) === external)
    throw new Error("Choose exactly one destination: --external or --to <path>.");
  const found = await findManifest(cwd);
  if (!found)
    throw new Error("Run relocation from the application's directory containing velloo.json.");
  const entries = [...found.folders].filter(
    ([, path]) =>
      path === source || (existsSync(path) && realpathSync(path) === realpathSync(source)),
  );
  if (entries.length !== 1 || !entries[0])
    throw new Error(
      "The source must have exactly one project registration in velloo.json before relocation.",
    );
  const name = entries[0][0];
  const physicalSource = realpathSync(source);
  const physicalRepo = realpathSync(found.dir);
  const sourceGit = await lstat(join(source, ".git")).catch(() => null);
  if (sourceGit && !sourceGit.isDirectory())
    throw new Error(
      "Cannot relocate a design with linked .git metadata. Use a standalone design repository first.",
    );
  if (physicalSource === physicalRepo)
    throw new Error(
      "Cannot relocate the application repository itself. Use a separate design directory.",
    );
  if (external && managedDesignId(source))
    throw new Error("This design already uses managed external storage.");
  const id = external ? randomUUID() : undefined;
  const destination = id ? managedDesignPath(id) : resolve(found.dir, to ?? "");
  const rel = relative(found.dir, destination);
  const physicalTarget = physicalDestination(destination);
  const physicalRel = relative(physicalRepo, physicalTarget);
  if (!external && (physicalRel === ".." || physicalRel.startsWith(`..${sep}`)))
    throw new Error(
      "--to must be inside the application repository; use --external for managed storage.",
    );
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
  return {
    source,
    destination,
    appRoot: managedProjectContext(source)?.appRoot ?? found.dir,
    manifestPath: found.path,
    projectName: name,
    ...(id ? { managedId: id } : {}),
    before: await readFile(found.path, "utf8"),
    manifest: {
      ...found.manifest,
      projects: {
        ...found.manifest.projects,
        [name]: id ? { managed: id } : rel.split(sep).join("/"),
      },
    },
  };
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
    await rebaseDesignConfig(plan.source, plan.destination, plan.appRoot, Boolean(plan.managedId));
    await loadDesignFolder(plan.destination, { preferences: false });
    if (plan.managedId)
      await checkpoint(plan.destination, "Relocate design to managed storage", true);
    if ((await fingerprint(plan.source)) !== original)
      throw new Error("The source changed during relocation. Close editors and retry.");
    if ((await readFile(plan.manifestPath, "utf8")) !== plan.before)
      throw new Error("The manifest changed during relocation. Review it and retry.");
    if (plan.managedId)
      await writeManagedBinding(plan.managedId, {
        appRoot: plan.appRoot,
        manifestPath: plan.manifestPath,
        projectName: plan.projectName,
      });
    await writeJsonAtomic(plan.manifestPath, plan.manifest);
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
