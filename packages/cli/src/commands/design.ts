import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import { designNameIssue } from "@velloo/schema";
import {
  designRenameConflict,
  followDesignRename,
  loadDesignFolder,
  localDesignOf,
  managedDesignId,
  recordedDesignName,
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
import {
  checkoutDesigns,
  DESIGN_ARG_DESCRIPTION,
  DESIGN_ID_ARG,
  hasDesignConfig,
  resolveDesign,
} from "../design.ts";
import { fail } from "../fail.ts";
import { planRelocation, relocateDesign } from "../managed-folders.ts";
import {
  checkoutRoot,
  findDesigns,
  findManifest,
  isWithin,
  registerLocalDesign,
  unregisterDesign,
  writeDesignName,
} from "../manifest.ts";
import { displayPath } from "./init/output.ts";
import { runInit } from "./init.ts";
import { migrateFolder } from "./upgrade.ts";

/**
 * A repo's designs, as a noun with verbs — one command instead of a top-level
 * verb per operation. `add` is `init` with the folder already chosen, so there
 * is exactly one scaffold path.
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
  meta: { name: "list", description: "List the repo's designs" },
  async run() {
    const cwd = resolve(".");
    const found = await findDesigns(cwd).catch((err: unknown) => {
      fail("design list", (err as Error).message);
    });
    if (!found || found.designs.length === 0) {
      const only = await resolveDesign(undefined, "design list", {
        requireConfig: true,
        cwd,
        onFail: () => fail("design list", "no designs here — `velloo init` creates one."),
      });
      const name = recordedDesignName(only) ?? "(unnamed)";
      console.log(`velloo design: 1 design (no velloo.json yet)`);
      console.log(
        `  ${pc.dim("1")}  ${pc.bold(name)}  ${relative(cwd, only) || only}  ${await daemonState(only)}`,
      );
      console.log(pc.dim("  `velloo design add` creates a second design and lists both."));
      return;
    }

    const base = found.repo?.dir ?? found.local[0]?.root ?? cwd;
    const rows: { name: string; path: string; boards: number; state: string; live: boolean }[] = [];
    for (const design of found.designs) {
      const live = design.exists && !design.outsideRepo;
      rows.push({
        name: found.conflicts.has(design.name) ? `${design.name} (duplicate)` : design.name,
        // A local design is somewhere only this machine knows about — say so,
        // since nobody else cloning the repo will see it.
        path: design.local
          ? `${displayPath(design.root)} (local)`
          : relative(base, design.root) || ".",
        boards: live ? await countJson(join(design.root, "boards"), ".notes.json") : 0,
        state: design.outsideRepo
          ? pc.yellow("outside the repo")
          : live
            ? await daemonState(design.root)
            : pc.yellow("missing"),
        live,
      });
    }
    // Display width, not string length: emoji and CJK take two columns.
    const pad = (text: string, width: number) =>
      text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));
    const width = Math.max(...rows.map((r) => Bun.stringWidth(r.name)));
    const pathWidth = Math.max(...rows.map((r) => Bun.stringWidth(r.path)));
    const idWidth = String(rows.length).length;
    console.log(`velloo design: ${rows.length} in ${base}`);
    for (const [index, row] of rows.entries()) {
      const marker = row.name === found.defaultDesign ? pc.cyan("●") : " ";
      const id = pc.dim(String(index + 1).padStart(idWidth));
      const boards = row.live ? `${row.boards} board${row.boards === 1 ? "" : "s"}` : "—";
      console.log(
        `  ${id} ${marker} ${pc.bold(pad(row.name, width))}  ${pc.dim(pad(row.path, pathWidth))}  ${boards.padEnd(9)}  ${row.state}`,
      );
    }
    console.log(pc.dim("  Pass a number as --id to the other `velloo design` commands."));
    for (const [name, designs] of found.conflicts) {
      console.log(
        pc.yellow(
          `  ! ${designs.length} designs are named "${name}" — rename one with \`velloo design rename <path> <new-name>\`.`,
        ),
      );
    }
  },
});

const add = defineCommand({
  meta: {
    name: "add",
    description: "Create another design in this repo (the init wizard, folder pre-chosen)",
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
    name: { type: "string", description: "The design's name (default: derived from its folder)" },
  },
  async run({ args }) {
    await runInit({
      addFolder: true,
      external: args.external,
      nonInteractive: args.nonInteractive,
      connect: args.connect,
      ...(args.path ? { designFolder: args.path } : {}),
      ...(args.library ? { library: args.library } : {}),
      ...(args.name ? { name: args.name } : {}),
    });
  },
});

const remove = defineCommand({
  meta: {
    name: "remove",
    description:
      "Remove a design — one outside the repo can keep its files (asked, or --delete-content)",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: DESIGN_ARG_DESCRIPTION,
    },
    id: DESIGN_ID_ARG,
    deleteContent: {
      type: "boolean",
      description:
        "Also delete the files of a design outside the repo (with --yes, or to skip the question)",
    },
    yes: {
      type: "boolean",
      description: "Skip the confirmation (required without an interactive terminal)",
    },
  },
  async run({ args }) {
    const cwd = resolve(".");
    const folder = await resolveDesign(args.design, "design remove", {
      id: args.id,
      interactive: true,
      requireConfig: true,
      cwd,
    });
    // A design outside the checkout can be forgotten and its files kept — its
    // folder may be one the user picked. Without a terminal to ask in, that's
    // the safe default unless --delete-content says otherwise.
    const local = localDesignOf(folder);
    const interactive = Boolean(process.stdin.isTTY);
    if (!interactive && args.yes !== true) {
      fail("design remove", "refusing to delete a design folder without --yes");
    }

    const boards = await countJson(join(folder, "boards"), ".notes.json");
    const screens = await countJson(join(folder, "screens"), ".annotations.json");
    const name = recordedDesignName(folder) ?? folder;
    console.log(`velloo design: ${name} (${folder})`);
    console.log(
      pc.dim(
        `  ${boards} board${boards === 1 ? "" : "s"}, ${screens} screen${screens === 1 ? "" : "s"}`,
      ),
    );

    let keepContent = local !== null && args.deleteContent !== true;
    if (args.yes !== true) {
      if (local && args.deleteContent !== true) {
        // Managed storage is Velloo's own directory — nothing else points at it,
        // so deleting is the likelier intent there; a chosen folder is the user's.
        const managed = managedDesignId(folder) !== null;
        const choice = await select({
          message: "Remove this design?",
          initialValue: managed ? "delete" : "keep",
          options: [
            {
              value: "delete",
              label: "Delete it and its files",
              hint: managed ? "in Velloo's storage" : folder,
            },
            { value: "keep", label: "Forget it, keep the files", hint: folder },
            { value: "cancel", label: "Cancel" },
          ],
        });
        if (isCancel(choice) || choice === "cancel") {
          console.log(pc.dim("  Nothing changed."));
          return;
        }
        keepContent = choice === "keep";
      } else {
        const approved = await confirm({
          message: "Delete this design folder and everything in it?",
          initialValue: false,
        });
        if (isCancel(approved) || !approved) {
          console.log(pc.dim("  Nothing changed."));
          return;
        }
      }
    }

    // Stop first: a live daemon holds the folder open, keeps serving a canvas
    // for files that are about to vanish, and would notice the deletion only
    // via its own existence poll.
    const stopped = await stopDaemon(daemonRoot(folder));
    if (stopped) console.log(pc.dim("  Stopped its canvas."));

    const dropped = local
      ? null
      : await unregisterDesign(folder, cwd).catch((err: unknown) =>
          fail("design remove", (err as Error).message),
        );
    if (local) await removeLocalDesign(local.id);
    if (!keepContent) await rm(folder, { recursive: true, force: true });
    console.log(`velloo design: ${keepContent ? "retained content at" : "removed"} ${folder}`);
    if (local) console.log(pc.dim(`  Forgot the local design "${name}".`));
    if (dropped?.name) {
      console.log(
        pc.dim(
          dropped.removedManifest
            ? `  Dropped "${dropped.name}" — velloo.json listed no other designs, so it's gone too.`
            : `  Dropped "${dropped.name}" from velloo.json.`,
        ),
      );
    }
  },
});

const move = defineCommand({
  meta: {
    name: "move",
    description:
      "Preview moving a design between the repository, managed storage and another directory; --yes applies",
  },
  args: {
    design: { type: "positional", required: false, description: DESIGN_ARG_DESCRIPTION },
    id: DESIGN_ID_ARG,
    external: { type: "boolean", description: "Move to managed storage (a local design)" },
    to: {
      type: "string",
      description:
        "New directory — inside the repository it goes in velloo.json, outside it is local",
    },
    yes: { type: "boolean", description: "Apply the displayed move" },
  },
  async run({ args }) {
    const source = await resolveDesign(args.design, "design move", {
      id: args.id,
      interactive: true,
      requireConfig: true,
    });
    const plan = await planRelocation(source, resolve("."), args.to, args.external === true).catch(
      (err: unknown) => fail("design move", (err as Error).message),
    );
    const local = "a local design on this machine";
    const recorded = plan.sourceManifestPath
      ? plan.destinationLocal
        ? `velloo.json path "${plan.sourceManifestPath}" → ${local}`
        : `velloo.json path "${plan.sourceManifestPath}" → "${plan.destinationManifestPath}"`
      : plan.destinationLocal
        ? `stays ${local}`
        : `${local} → velloo.json path "${plan.destinationManifestPath}"`;
    console.log(
      `Source: ${plan.source}\nDestination: ${plan.destination}\nDesign "${plan.designName}": ${recorded}`,
    );
    if (!args.yes) {
      console.log("Preview only. Add --yes to apply the move.");
      return;
    }
    await relocateDesign(plan);
    console.log(
      `Moved ${plan.designName} to ${plan.destination}. Run velloo connect to refresh existing agent guidance.`,
    );
  },
});

const rename = defineCommand({
  meta: { name: "rename", description: "Rename a design" },
  args: {
    design: {
      type: "positional",
      required: false,
      description: "The design to rename — its current name or its folder path (or use --id)",
    },
    name: { type: "positional", required: false, description: "The new name" },
    id: DESIGN_ID_ARG,
  },
  async run({ args }) {
    const cwd = resolve(".");
    // With --id the only positional is the new name.
    const newName = args.id !== undefined && args.name === undefined ? args.design : args.name;
    const target = args.id !== undefined && args.name === undefined ? undefined : args.design;
    if (newName === undefined)
      fail(
        "design rename",
        "pass the design and its new name: `velloo design rename <design> <new name>`.",
      );
    const folder = await resolveDesign(target, "design rename", {
      id: args.id,
      requireConfig: true,
      cwd,
    });
    const previous = recordedDesignName(folder);
    if (previous === newName) {
      console.log(pc.dim(`  Already named "${newName}" — nothing changed.`));
      return;
    }
    const conflict = await designRenameConflict(folder, newName).catch((err: unknown) =>
      fail("design rename", (err as Error).message),
    );
    if (conflict) fail("design rename", conflict);

    // The daemon holds the loaded config, and would write the old name back.
    await stopDaemon(daemonRoot(folder));
    await writeDesignName(folder, newName);
    if (previous && (await followDesignRename(folder, previous, newName)))
      console.log(pc.dim(`  velloo.json defaultDesign → "${newName}"`));
    console.log(`velloo design: renamed ${previous ? `"${previous}" ` : ""}to "${newName}".`);
  },
});

const upgrade = defineCommand({
  meta: {
    name: "upgrade",
    description: "Migrate a design to this Velloo's format, without upgrading Velloo itself",
  },
  args: {
    design: { type: "positional", required: false, description: DESIGN_ARG_DESCRIPTION },
    id: DESIGN_ID_ARG,
    all: { type: "boolean", description: "Migrate every design in this checkout" },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Show what would change without writing",
    },
    skills: {
      type: "boolean",
      default: true,
      description:
        "Also refresh the installed agent skills / plugin / rules to this velloo's versions",
    },
  },
  async run({ args }) {
    if (args.all && (args.design || args.id !== undefined))
      fail("design upgrade", "pass a design or --all, not both.");
    const folders = args.all
      ? await checkoutDesigns(resolve("."))
      : [
          await resolveDesign(args.design, "design upgrade", {
            id: args.id,
            interactive: true,
            requireConfig: true,
          }),
        ];
    if (folders.length === 0)
      fail("design upgrade", "no designs here — `velloo init` creates one.");
    for (const folder of folders) {
      await migrateFolder(folder, { dryRun: args["dry-run"], skills: args.skills });
    }
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
    name: { type: "string", description: "Rename the design as it is bound" },
    yes: { type: "boolean", description: "Confirm the local binding" },
  },
  async run({ args }) {
    const cwd = resolve(".");
    const folder = resolve(args.design);
    if (!(await hasDesignConfig(folder)))
      fail("design bind", `${folder} is not a velloo design folder (no .design/config.json).`);
    const root = await checkoutRoot(cwd, cwd);
    if (isWithin(root, folder))
      fail(
        "design bind",
        `${folder} is inside this checkout (${root}); a design here belongs in velloo.json — see \`velloo design add\`.`,
      );
    const name = args.name ?? recordedDesignName(folder);
    if (!name)
      fail("design bind", `${folder} has no design name — run \`velloo upgrade ${folder}\` first.`);
    const issue = designNameIssue(name);
    if (issue) fail("design bind", `invalid --name ${JSON.stringify(name)} — ${issue}`);
    const set = await findDesigns(root).catch((err: unknown) =>
      fail("design bind", (err as Error).message),
    );
    const clash = set?.designs.find(
      (d) =>
        d.name === name && !(existsSync(d.root) && realpathSync(d.root) === realpathSync(folder)),
    );
    if (clash)
      fail(
        "design bind",
        `a design named "${name}" already exists at ${clash.root} — pass --name to bind this one under another.`,
      );
    const existing = localDesignOf(folder);
    // Keep the design aimed at the same app within the checkout, so a moved
    // monorepo still resolves `apps/web`.
    const appRoot = existing ? join(root, relative(existing.root, existing.appRoot)) : root;
    const repo = await findManifest(cwd).catch(() => null);
    const listed = repo?.folders.some(
      (path) => existsSync(path) && realpathSync(path) === realpathSync(folder),
    );
    console.log(`Design: ${name} (${folder})\nCheckout: ${root}\nApplication: ${appRoot}`);
    if (listed) console.log("velloo.json: drops its entry, which cannot point outside the repo");
    if (!args.yes) {
      console.log("Preview only. Add --yes to confirm this local binding.");
      return;
    }
    await loadDesignFolder(folder, { preferences: false });
    await stopDaemon(daemonRoot(folder));
    if (listed)
      await unregisterDesign(folder, cwd).catch((err: unknown) =>
        fail("design bind", (err as Error).message),
      );
    if (name !== recordedDesignName(folder)) await writeDesignName(folder, name);
    await registerLocalDesign({
      id: existing?.id ?? managedDesignId(folder) ?? randomUUID(),
      root,
      appRoot: existsSync(appRoot) ? appRoot : root,
      ...(managedDesignId(folder) ? {} : { designPath: folder }),
    }).catch((err: unknown) => fail("design bind", (err as Error).message));
    console.log(`Bound "${name}" to ${root} on this machine.`);
  },
});

const setAppRoot = defineCommand({
  meta: {
    name: "set-app-root",
    description: "Point a design at a different application root",
  },
  args: {
    design: { type: "positional", required: false, description: DESIGN_ARG_DESCRIPTION },
    id: DESIGN_ID_ARG,
    to: {
      type: "string",
      description: "New application root (asked from the repo's apps when omitted)",
    },
    yes: { type: "boolean", description: "Apply the displayed change" },
  },
  async run({ args }) {
    const folder = await resolveDesign(args.design, "design set-app-root", {
      id: args.id,
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
      fail("design set-app-root", (err as Error).message),
    );
    if (resolve(change.to) === resolve(change.from)) {
      console.log(pc.dim("  Already pointing there — nothing changed."));
      return;
    }
    if (!existsSync(change.to)) fail("design set-app-root", `${change.to} does not exist.`);

    console.log(`New application: ${change.to}`);
    if (!existsSync(join(change.to, "package.json")))
      console.log(
        pc.yellow(`  ! no package.json there — codegen and live islands will not resolve`),
      );
    if (change.local) console.log(pc.dim(`  local design record: appRoot → ${change.to}`));
    for (const r of change.rewritten) console.log(pc.dim(`  ${r.field}: ${r.from} → ${r.to}`));
    if (!args.yes) {
      console.log("Preview only. Add --yes to apply.");
      return;
    }

    // The daemon holds the resolved application root for its whole lifetime —
    // provider loading, the live-island bundler, codegen paths.
    await stopDaemon(daemonRoot(folder));
    await applyAppRootChange(folder, change);
    console.log(`velloo design: application root is now ${change.to}`);
  },
});

export default defineCommand({
  meta: {
    name: "design",
    description: "Manage this repo's designs (list, add, remove, move, rename, upgrade, …)",
  },
  subCommands: {
    list,
    add,
    remove,
    move,
    rename,
    upgrade,
    bind,
    "set-app-root": setAppRoot,
  },
  // Bare `velloo design` is the question "what have I got?" — answer it
  // rather than printing usage.
  run: ({ args }) => (args._?.length ? undefined : list.run?.({ args, cmd: list, rawArgs: [] })),
});
