import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";
import pc from "picocolors";
import { daemonRoot, isLive, readLock, stopDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, hasDesignConfig, resolveDesignFolder } from "../folder.ts";
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
    library: { type: "string", description: "Component library (default: the sibling folder's)" },
    project: { type: "string", description: "Project name for velloo.json" },
  },
  async run({ args }) {
    await runInit({
      addFolder: true,
      ...(args.path ? { designFolder: args.path } : {}),
      ...(args.library ? { library: args.library } : {}),
      ...(args.project ? { project: args.project } : {}),
    });
  },
});

const remove = defineCommand({
  meta: {
    name: "remove",
    description: "Delete a design folder and drop it from velloo.json",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
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
    const interactive = Boolean(process.stdin.isTTY);
    if (!interactive && args.yes !== true) {
      fail("folder", "refusing to delete a design folder without --yes");
    }

    const boards = await countJson(join(folder, "boards"), ".notes.json");
    const screens = await countJson(join(folder, "screens"), ".annotations.json");
    console.log(`velloo folder: ${folder}`);
    console.log(
      pc.dim(
        `  ${boards} board${boards === 1 ? "" : "s"}, ${screens} screen${screens === 1 ? "" : "s"} — deleted from disk.`,
      ),
    );

    if (args.yes !== true) {
      const approved = await confirm({
        message: `Delete this design folder? ${pc.dim("(committed designs are still recoverable with git)")}`,
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

    await rm(folder, { recursive: true, force: true });
    const dropped = await unregisterProject(folder, cwd).catch(() => null);
    console.log(`velloo folder: removed ${folder}`);
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

export default defineCommand({
  meta: {
    name: "folder",
    description: "Manage this repo's design folders (list, add, remove)",
  },
  subCommands: { list, add, remove },
  // Bare `velloo folder` is the question "what have I got?" — answer it
  // rather than printing usage.
  run: ({ args }) => (args._?.length ? undefined : list.run?.({ args, cmd: list, rawArgs: [] })),
});
