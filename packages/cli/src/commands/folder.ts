import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import {
  loadDesignFolder,
  localDesignOf,
  managedDesignId,
  removeLocalDesign,
} from "@velloo/server";
import { defineCommand } from "citty";
import pc from "picocolors";
import {
  applyAppRootChange,
  planAppRootChange,
  promptAppRootChoice,
  recordedAppRoot,
} from "../app-root.ts";
import { daemonRoot, isLive, readLock, stopDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import {
  FOLDER_ARG_DESCRIPTION,
  hasDesignConfig,
  resolveDesignFolder,
  resolveDesignLocation,
} from "../folder.ts";
import { planRelocation, relocateDesign } from "../managed-folders.ts";
import {
  checkoutRoot,
  findManifest,
  findProjects,
  isWithin,
  registerLocalDesign,
  unregisterProject,
} from "../manifest.ts";
import { displayPath } from "./init/output.ts";
import { runInit } from "./init.ts";

/**
 * The design folders of a repo, as a noun with verbs — one command instead of
 * a top-level verb per operation. `add` is `init` with the folder already
 * chosen, so there is exactly one scaffold path.
 */

async function countJson(dir: string, skipSuffix?: string): Promise<number> {
  try {
    return (await readdir(dir)).filter(
      (f) => f.endsWith(".json") && !(skipSuffix && f.endsWith(skipSuffix)),
    ).length;
  } catch {
    return 0;
  }
}

async function daemonState(folder: string): Promise<string> {
  const rec = await readLock(daemonRoot(folder));
  if (!rec) return "stopped";
  return (await isLive(rec)) ? `running :${rec.canvasPort}` : "stopped";
}

const list = defineCommand({
  meta: { name: "list", description: "List the repo's design folders" },
  async run() {
    const cwd = resolve(".");
    const found = await findProjects(cwd).catch((err: unknown) => {
      fail("folder", (err as Error).message);
    });
    if (!found || found.folders.size === 0) {
      const only = await resolveDesignFolder(undefined, "folder", { requireConfig: true, cwd });
      console.log(`velloo folder: 1 design folder (no velloo.json yet)`);
      console.log(`  ${relative(cwd, only) || only}  ${await daemonState(only)}`);
      console.log(pc.dim("  `velloo folder add` registers a manifest and a second folder."));
      return;
    }

    const base = found.repo?.dir ?? found.local[0]?.root ?? cwd;
    const localNames = new Set(found.local.map((design) => design.projectName));
    const rows: { name: string; path: string; boards: number; state: string; live: boolean }[] = [];
    for (const [name, folder] of found.folders) {
      const live = await hasDesignConfig(folder);
      rows.push({
        name,
        // A local design is somewhere only this machine knows about — say so,
        // since nobody else cloning the repo will see it.
        path: localNames.has(name)
          ? `${displayPath(folder)} (local)`
          : relative(base, folder) || ".",
        boards: live ? await countJson(join(folder, "boards"), ".notes.json") : 0,
        state: live ? await daemonState(folder) : pc.yellow("missing"),
        live,
      });
    }
    const width = Math.max(...rows.map((r) => r.name.length));
    const pathWidth = Math.max(...rows.map((r) => r.path.length));
    console.log(`velloo folder: ${rows.length} in ${base}`);
    for (const row of rows) {
      const marker = row.name === found.defaultProject ? pc.cyan("●") : " ";
      const boards = row.live ? `${row.boards} board${row.boards === 1 ? "" : "s"}` : "—";
      console.log(
        `  ${marker} ${pc.bold(row.name.padEnd(width))}  ${pc.dim(row.path.padEnd(pathWidth))}  ${boards.padEnd(9)}  ${row.state}`,
      );
    }
  },
});

const add = defineCommand({
  meta: {
    name: "add",
    description: "Scaffold another design folder in this repo (the init wizard, folder pre-chosen)",
  },
  args: {
    path: {
      type: "positional",
      required: false,
      description: "Where the new design folder goes, relative to the repo (asked when omitted)",
    },
    external: { type: "boolean", description: "Create in Velloo-managed external storage" },
    nonInteractive: { type: "boolean", description: "Use defaults without prompting" },
    connect: { type: "boolean", default: true, description: "Wire project agents" },
    library: { type: "string", description: "Component library (default: the sibling folder's)" },
    project: { type: "string", description: "Project name for velloo.json" },
  },
  async run({ args }) {
    await runInit({
      addFolder: true,
      external: args.external,
      nonInteractive: args.nonInteractive,
      connect: args.connect,
      ...(args.path ? { designFolder: args.path } : {}),
      ...(args.library ? { library: args.library } : {}),
      ...(args.project ? { project: args.project } : {}),
    });
  },
});

const remove = defineCommand({
  meta: {
    name: "remove",
    description: "Remove a project; external content is kept unless --delete-content is passed",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
    },
    deleteContent: {
      type: "boolean",
      description: "Also delete external design content",
    },
    yes: {
      type: "boolean",
      description: "Skip the confirmation (required without an interactive terminal)",
    },
  },
  async run({ args }) {
    const cwd = resolve(".");
    const folder = await resolveDesignFolder(args.folder, "folder", {
      interactive: true,
      requireConfig: true,
      cwd,
    });
    // A local design's folder is outside the checkout — often one the user
    // picked — so removing the project forgets it rather than deleting it.
    const local = localDesignOf(folder);
    const keepContent = local !== null && args.deleteContent !== true;
    const interactive = Boolean(process.stdin.isTTY);
    if (!interactive && args.yes !== true) {
      fail("folder", "refusing to delete a design folder without --yes");
    }

    const boards = await countJson(join(folder, "boards"), ".notes.json");
    const screens = await countJson(join(folder, "screens"), ".annotations.json");
    console.log(`velloo folder: ${folder}`);
    console.log(
      pc.dim(
        `  ${boards} board${boards === 1 ? "" : "s"}, ${screens} screen${screens === 1 ? "" : "s"} — ${keepContent ? "registration removed; content retained." : "deleted from disk."}`,
      ),
    );

    if (args.yes !== true) {
      const approved = await confirm({
        message: keepContent
          ? "Remove this project registration and retain its external content?"
          : "Delete this design folder and everything in it?",
        initialValue: false,
      });
      if (isCancel(approved) || !approved) {
        console.log(pc.dim("  Nothing changed."));
        return;
      }
    }

    // Stop first: a live daemon holds the folder open, keeps serving a canvas
    // for files that are about to vanish, and would notice the deletion only
    // via its own existence poll.
    const stopped = await stopDaemon(daemonRoot(folder));
    if (stopped) console.log(pc.dim("  Stopped its canvas."));

    const dropped = local ? null : await unregisterProject(folder, cwd);
    if (local) await removeLocalDesign(local.id);
    if (!keepContent) await rm(folder, { recursive: true, force: true });
    console.log(`velloo folder: ${keepContent ? "retained content at" : "removed"} ${folder}`);
    if (local) console.log(pc.dim(`  Forgot the local design "${local.projectName}".`));
    if (dropped?.name) {
      console.log(
        pc.dim(
          dropped.removedManifest
            ? `  Dropped "${dropped.name}" — velloo.json had no other projects, so it's gone too.`
            : `  Dropped "${dropped.name}" from velloo.json.`,
        ),
      );
    }
  },
});

const relocate = defineCommand({
  meta: {
    name: "relocate",
    description:
      "Preview moving a design between the repository, managed storage and another directory; --yes applies",
  },
  args: {
    folder: { type: "positional", required: false, description: FOLDER_ARG_DESCRIPTION },
    external: { type: "boolean", description: "Move to managed storage (a local design)" },
    to: {
      type: "string",
      description:
        "New directory — inside the repository it goes in velloo.json, outside it is local",
    },
    yes: { type: "boolean", description: "Apply the displayed relocation" },
  },
  async run({ args }) {
    const location = await resolveDesignLocation(args.folder, "folder", { requireConfig: true });
    const plan = await planRelocation(
      location.designRoot,
      resolve("."),
      args.to,
      args.external === true,
    ).catch((err: unknown) => fail("folder", (err as Error).message));
    const recorded = plan.destinationLocal
      ? "a local design on this machine (not in velloo.json)"
      : `velloo.json → ${plan.manifest?.projects[plan.projectName]}`;
    console.log(
      `Source: ${plan.source}\nDestination: ${plan.destination}\nProject ${plan.projectName}: ${recorded}`,
    );
    if (!args.yes) {
      console.log("Preview only. Add --yes to apply relocation.");
      return;
    }
    await relocateDesign(plan);
    console.log(
      `Relocated ${plan.projectName} to ${plan.destination}. Run velloo connect to refresh existing agent guidance.`,
    );
  },
});

const bind = defineCommand({
  meta: {
    name: "bind",
    description: "Attach a design folder outside this checkout to it, on this machine only",
  },
  args: {
    design: {
      type: "positional",
      required: true,
      description: "The design folder (in managed storage or anywhere outside the checkout)",
    },
    project: { type: "string", description: "Project name (default: its current one)" },
    yes: { type: "boolean", description: "Confirm the local binding" },
  },
  async run({ args }) {
    const cwd = resolve(".");
    const folder = resolve(args.design);
    if (!(await hasDesignConfig(folder)))
      fail("folder", `${folder} is not a velloo design folder (no .design/config.json).`);
    const root = await checkoutRoot(cwd, cwd);
    if (isWithin(root, folder))
      fail(
        "folder",
        `${folder} is inside this checkout (${root}); a design here belongs in velloo.json — see \`velloo folder add\`.`,
      );
    const existing = localDesignOf(folder);
    // Keep the design aimed at the same app within the checkout, so a moved
    // monorepo still resolves `apps/web`.
    const appRoot = existing ? join(root, relative(existing.root, existing.appRoot)) : root;
    const repo = await findManifest(cwd).catch(() => null);
    const legacy = [...(repo?.folders ?? [])].find(
      ([, path]) => existsSync(path) && realpathSync(path) === realpathSync(folder),
    )?.[0];
    console.log(`Design: ${folder}\nCheckout: ${root}\nApplication: ${appRoot}`);
    if (legacy) console.log(`velloo.json: drops "${legacy}", which cannot point outside the repo`);
    if (!args.yes) {
      console.log("Preview only. Add --yes to confirm this local binding.");
      return;
    }
    await loadDesignFolder(folder, { preferences: false });
    await stopDaemon(daemonRoot(folder));
    if (legacy) await unregisterProject(folder, cwd);
    const name = await registerLocalDesign({
      id: existing?.id ?? managedDesignId(folder) ?? randomUUID(),
      root,
      appRoot: existsSync(appRoot) ? appRoot : root,
      ...(managedDesignId(folder) ? {} : { designPath: folder }),
      requestedName: args.project ?? existing?.projectName ?? legacy,
    }).catch((err: unknown) => fail("folder", (err as Error).message));
    console.log(`Bound "${name}" to ${root} on this machine.`);
  },
});

const setAppRoot = defineCommand({
  meta: {
    name: "set-app-root",
    description: "Point a design folder at a different application root",
  },
  args: {
    folder: { type: "positional", required: false, description: FOLDER_ARG_DESCRIPTION },
    to: {
      type: "string",
      description: "New application root (asked from the repo's apps when omitted)",
    },
    yes: { type: "boolean", description: "Apply the displayed change" },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "folder", {
      interactive: true,
      requireConfig: true,
    });
    const current = await recordedAppRoot(folder);
    console.log(`Design: ${folder}`);
    console.log(
      `Application: ${current.path}${current.exists ? (current.looksLikeApp ? "" : pc.yellow(" (no package.json)")) : pc.yellow(" (missing)")}`,
    );

    const target = args.to ? resolve(args.to) : await promptAppRootChoice(current.path);
    if (!target) {
      console.log(pc.dim("  No other application found in this repo — pass --to <path>."));
      return;
    }
    const change = await planAppRootChange(folder, target).catch((err: unknown) =>
      fail("folder", (err as Error).message),
    );
    if (resolve(change.to) === resolve(change.from)) {
      console.log(pc.dim("  Already pointing there — nothing changed."));
      return;
    }
    if (!existsSync(change.to)) fail("folder", `${change.to} does not exist.`);

    console.log(`New application: ${change.to}`);
    if (!existsSync(join(change.to, "package.json")))
      console.log(
        pc.yellow(`  ! no package.json there — codegen and live islands will not resolve`),
      );
    if (change.local)
      console.log(pc.dim(`  local design "${change.local.project}": appRoot → ${change.to}`));
    for (const r of change.rewritten) console.log(pc.dim(`  ${r.field}: ${r.from} → ${r.to}`));
    if (!args.yes) {
      console.log("Preview only. Add --yes to apply.");
      return;
    }

    // The daemon holds the resolved application root for its whole lifetime —
    // provider loading, the live-island bundler, codegen paths.
    await stopDaemon(daemonRoot(folder));
    await applyAppRootChange(folder, change);
    console.log(`velloo folder: application root is now ${change.to}`);
  },
});

export default defineCommand({
  meta: {
    name: "folder",
    description: "Manage this repo's design folders (list, add, remove)",
  },
  subCommands: {
    list,
    add,
    remove,
    relocate,
    bind,
    "set-app-root": setAppRoot,
  },
  // Bare `velloo folder` is the question "what have I got?" — answer it
  // rather than printing usage.
  run: ({ args }) => (args._?.length ? undefined : list.run?.({ args, cmd: list, rawArgs: [] })),
});
