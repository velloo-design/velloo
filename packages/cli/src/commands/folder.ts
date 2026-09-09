import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { loadDesignFolder, managedDesignId, writeManagedBinding } from "@velloo/server";
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
import { checkpoint, planRelocation, relocateDesign } from "../managed-folders.ts";
import { findManifest, unregisterProject } from "../manifest.ts";
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
    const found = await findManifest(cwd).catch((err: unknown) => {
      fail("folder", (err as Error).message);
    });
    if (!found || found.folders.size === 0) {
      const only = await resolveDesignFolder(undefined, "folder", { requireConfig: true, cwd });
      console.log(`velloo folder: 1 design folder (no velloo.json yet)`);
      console.log(`  ${relative(cwd, only) || only}  ${await daemonState(only)}`);
      console.log(pc.dim("  `velloo folder add` registers a manifest and a second folder."));
      return;
    }

    const rows: { name: string; path: string; boards: number; state: string; live: boolean }[] = [];
    for (const [name, folder] of found.folders) {
      const live = await hasDesignConfig(folder);
      rows.push({
        name,
        path: relative(found.dir, folder) || ".",
        boards: live ? await countJson(join(folder, "boards"), ".notes.json") : 0,
        state: live ? await daemonState(folder) : pc.yellow("missing"),
        live,
      });
    }
    const width = Math.max(...rows.map((r) => r.name.length));
    const pathWidth = Math.max(...rows.map((r) => r.path.length));
    console.log(`velloo folder: ${rows.length} in ${found.dir}`);
    for (const row of rows) {
      const marker = row.name === found.manifest.defaultProject ? pc.cyan("●") : " ";
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
      description: "Also delete external design content and its standalone Git history",
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
    const keepContent = managedDesignId(folder) !== null && args.deleteContent !== true;
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
          : "Delete this design folder and any standalone Git history it contains?",
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

    const dropped = await unregisterProject(folder, cwd);
    if (!keepContent) await rm(folder, { recursive: true, force: true });
    console.log(`velloo folder: ${keepContent ? "retained content at" : "removed"} ${folder}`);
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
    description: "Preview moving a design between repository and managed storage; --yes applies",
  },
  args: {
    folder: { type: "positional", required: false, description: FOLDER_ARG_DESCRIPTION },
    external: { type: "boolean", description: "Move to managed external storage" },
    to: { type: "string", description: "New directory inside the application repository" },
    yes: { type: "boolean", description: "Apply the displayed relocation" },
  },
  async run({ args }) {
    const location = await resolveDesignLocation(args.folder, "folder", { requireConfig: true });
    const plan = await planRelocation(
      location.designRoot,
      resolve("."),
      args.to,
      args.external === true,
    );
    console.log(
      `Source: ${plan.source}\nDestination: ${plan.destination}\nManifest: ${plan.manifestPath}\nProject ${plan.projectName}: ${JSON.stringify(plan.manifest.projects[plan.projectName])}`,
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
    description: "Explicitly bind a restored managed design to this application checkout",
  },
  args: {
    project: {
      type: "positional",
      required: true,
      description: "Managed project name in velloo.json",
    },
    yes: { type: "boolean", description: "Confirm the local application binding" },
  },
  async run({ args }) {
    const found = await findManifest(resolve("."));
    const entry = found?.manifest.projects[args.project];
    if (!found || !entry || typeof entry === "string")
      fail("folder", "Choose a managed project in this application's velloo.json.");
    const folder = found.folders.get(args.project) as string;
    console.log(`Design: ${folder}\nApplication: ${found.dir}\nProject: ${args.project}`);
    if (!args.yes) {
      console.log("Preview only. Add --yes to confirm this local binding.");
      return;
    }
    await loadDesignFolder(folder, { preferences: false });
    await stopDaemon(daemonRoot(folder));
    await writeManagedBinding(entry.managed, {
      manifestPath: found.path,
      appRoot: resolve(found.dir, entry.appRoot ?? "."),
      projectName: args.project,
    });
    console.log("Local binding saved.");
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
    if (change.manifest)
      console.log(
        pc.dim(
          `  ${change.manifest.path}: projects.${change.manifest.project}.appRoot → ${change.manifest.to}`,
        ),
      );
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

const checkpointCommand = defineCommand({
  meta: {
    name: "checkpoint",
    description: "Save a named durable Git checkpoint of a managed design",
  },
  args: {
    folder: { type: "positional", required: false, description: FOLDER_ARG_DESCRIPTION },
    message: { type: "string", required: true, description: "Checkpoint name" },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "folder", { requireConfig: true });
    console.log(`Checkpoint saved: ${await checkpoint(folder, args.message)}`);
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
    checkpoint: checkpointCommand,
  },
  // Bare `velloo folder` is the question "what have I got?" — answer it
  // rather than printing usage.
  run: ({ args }) => (args._?.length ? undefined : list.run?.({ args, cmd: list, rawArgs: [] })),
});
