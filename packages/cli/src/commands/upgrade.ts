import { resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { recordedDesignName } from "@velloo/server";
import { defineCommand } from "citty";
import pc from "picocolors";
import { refreshAgentArtifacts } from "../connect/index.ts";
import { agentRootCandidates } from "../connect/project-root.ts";
import { repinAgentConfigs } from "../connect/repin.ts";
import { daemonRoot, isLive, readLock, stopDaemon } from "../daemon/runtime.ts";
import { checkoutDesigns, DESIGN_ARG_DESCRIPTION, resolveDesign } from "../design.ts";
import { fail } from "../fail.ts";
import { createProgress } from "../progress.ts";
import { installedVellooBin } from "../release.ts";
import { type UpgradeOutcome, upgradeInstalledVelloo } from "../update.ts";
import { upgradeFolder } from "../upgrade-folder.ts";

/**
 * The designs this upgrade should migrate. An explicit argument names one, and
 * still has to be real — a typo must not be silently downgraded to "binary
 * only". Without one, every design in the checkout: a new velloo can't open any
 * design left on the old format, so upgrading only the one the directory
 * happens to pick would strand the rest. Outside any design, none.
 */
async function targetFolders(arg: string | undefined): Promise<string[]> {
  if (arg) return [await resolveDesign(arg, "upgrade", { requireConfig: true })];
  return checkoutDesigns(resolve("."));
}

export default defineCommand({
  meta: {
    name: "upgrade",
    description:
      "Upgrade Velloo and migrate designs to the current format — every design in this checkout, or the one named",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: DESIGN_ARG_DESCRIPTION,
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Show what would change without writing",
    },
    check: {
      type: "boolean",
      default: false,
      description: "Check for a Velloo update without installing it",
    },
    "binary-only": {
      type: "boolean",
      default: false,
      description: "Upgrade the Velloo installation and leave the designs alone",
    },
    "design-only": {
      type: "boolean",
      default: false,
      description:
        "Migrate the designs with this Velloo, without self-upgrading first (same as `velloo design upgrade`)",
    },
    skills: {
      type: "boolean",
      default: true,
      description:
        "Also refresh the installed agent skills / plugin / rules to this velloo's versions",
    },
  },
  async run({ args }) {
    const dryRun = args["dry-run"] || args.check;
    const folders = args["binary-only"] ? [] : await targetFolders(args.design);

    let outcome: UpgradeOutcome | null = null;
    // `--folder-only` is what a 0.1.x velloo passes to the build it just installed.
    const designOnly =
      args["design-only"] || (args as Record<string, unknown>)["folder-only"] === true;
    if (!designOnly) {
      try {
        outcome = await upgradeInstalledVelloo({ checkOnly: dryRun });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // With a folder to migrate, an installation velloo can't replace (a
        // source checkout, an unmarked install) is a note, not a failure —
        // the folder migration is the half that still has work to do.
        if (folders.length === 0) fail("upgrade", message);
        console.log(pc.dim(`velloo: skipping the self-upgrade — ${message}`));
      }
    }

    if (folders.length === 0) return;

    // The running process is the OLD binary: it can only migrate to the schema
    // version it was compiled with. Hand the folder half to the build that was
    // just installed, which is the one that knows the newer format — one run
    // per design, named by path so it needn't re-resolve anything.
    if (outcome?.upgraded) {
      const bin = installedVellooBin();
      if (bin) {
        for (const folder of folders) {
          const argv = [
            bin,
            "upgrade",
            folder,
            "--design-only",
            ...(args.skills ? [] : ["--no-skills"]),
          ];
          const code = await Bun.spawn(argv, {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            env: { ...process.env, VELLOO_DISABLE_UPDATE_CHECK: "1" },
          }).exited;
          if (code !== 0) fail("upgrade", `the upgraded velloo could not migrate ${folder}`);
        }
        return;
      }
      console.log(
        pc.dim(
          `velloo: could not locate the upgraded velloo — run \`velloo upgrade\` again to migrate ${folders.length === 1 ? "the design" : "the designs"}.`,
        ),
      );
      return;
    }

    for (const folder of folders) await migrateFolder(folder, { dryRun, skills: args.skills });
  },
});

export async function migrateFolder(
  folder: string,
  opts: { dryRun: boolean; skills: boolean },
): Promise<void> {
  const { dryRun } = opts;
  const progress = createProgress();
  progress.start(dryRun ? "checking upgrade" : "preparing upgrade");

  let stopped = false;
  let result: Awaited<ReturnType<typeof upgradeFolder>>;
  try {
    if (!dryRun) {
      // A live daemon would race the rewrite (and an old binary can't read the
      // migrated folder anyway) — stop it first, like a real package manager.
      const root = daemonRoot(folder);
      const running = await readLock(root);
      if (running && (await isLive(running))) progress.step("stopping running canvas");
      stopped = await stopDaemon(root);
    }
    progress.step(dryRun ? "checking design folder" : "upgrading design folder");
    result = await upgradeFolder(folder, { dryRun });
  } catch (err) {
    progress.fail("upgrade failed");
    fail("upgrade", err instanceof Error ? err.message : String(err));
  }

  let refreshed: string[] = [];
  let repinned: string[] = [];
  try {
    // Not guidance but wiring that 0.1.0 got wrong: a config pinning the design
    // by name stops starting the agent's MCP server once the design is renamed.
    const name = recordedDesignName(folder);
    if (!dryRun && name) {
      repinned = await repinAgentConfigs({
        projectRoots: await agentRootCandidates(folder),
        designFolder: folder,
        names: [name],
      });
    }
    // The skills and the plugin ship with the binary, so a new velloo means new
    // guidance — and a stale skill is worse than a missing one, since it keeps
    // confidently describing tools that changed underneath it. Refresh what's
    // installed; wiring something new stays `velloo connect`.
    if (opts.skills && !dryRun) {
      progress.step("refreshing agent guidance");
      const projectRoots = await agentRootCandidates(folder);
      ({ refreshed } = await refreshAgentArtifacts({ projectRoots, designFolder: folder }));
    }
    progress.succeed(dryRun ? "upgrade check complete" : "upgrade complete");
  } catch (error) {
    progress.fail("upgrade failed");
    throw error;
  }

  if (stopped) console.log("velloo: stopped the running canvas for this folder.");

  if (result.applied.length === 0) {
    console.log(`velloo: ${folder} is already at schema version ${CURRENT_SCHEMA_VERSION}.`);
    for (const file of result.changedFiles)
      console.log(`  ${dryRun ? "~" : "✓"} ${file} (designs list format)`);
  } else {
    const verb = dryRun ? "would migrate" : "migrated";
    console.log(`velloo: ${verb} ${folder} from schema version ${result.from} to ${result.to}:`);
    for (const step of result.applied) console.log(`  - ${step}`);
    for (const file of result.changedFiles) console.log(`  ${dryRun ? "~" : "✓"} ${file}`);
    if (!dryRun) console.log("velloo: folder validated against the current schemas.");
  }

  if (repinned.length > 0) {
    console.log("");
    console.log(pc.green("✓ Agent MCP configs now find the design without naming it:"));
    for (const path of repinned) console.log(`    ${pc.cyan(path)}`);
  }

  if (refreshed.length > 0) {
    console.log("");
    console.log(pc.green("✓ Refreshed agent guidance to this velloo:"));
    for (const line of refreshed) console.log(`    ${pc.cyan(line)}`);
  }
}
