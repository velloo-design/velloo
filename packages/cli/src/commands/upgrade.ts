import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { defineCommand } from "citty";
import pc from "picocolors";
import { refreshAgentArtifacts } from "../connect/index.ts";
import { agentRootCandidates } from "../connect/project-root.ts";
import { daemonRoot, stopDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";
import { createProgress } from "../progress.ts";
import { installedVellooBin } from "../release.ts";
import { type UpgradeOutcome, upgradeInstalledVelloo } from "../update.ts";
import { upgradeFolder } from "../upgrade-folder.ts";

/**
 * The design folder this upgrade should migrate, or null when the command was
 * run somewhere that simply has no design in it.
 *
 * An explicit argument still has to name a real folder — a typo must not be
 * silently downgraded to "binary only". Without one, resolution failing is the
 * ordinary case of upgrading velloo from anywhere at all.
 */
async function targetFolder(arg: string | undefined): Promise<string | null> {
  if (arg) return resolveDesignFolder(arg, "upgrade", { requireConfig: true });
  try {
    return await resolveDesignFolder(undefined, "upgrade", {
      requireConfig: true,
      onFail: () => {
        throw new Error("no design folder here");
      },
    });
  } catch {
    return null;
  }
}

export default defineCommand({
  meta: {
    name: "upgrade",
    description: "Upgrade Velloo and migrate the design folder to the current format",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
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
      description: "Upgrade the Velloo installation and leave the design folder alone",
    },
    "folder-only": {
      type: "boolean",
      default: false,
      description: "Migrate the design folder with this Velloo, without self-upgrading first",
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
    const folder = args["binary-only"] ? null : await targetFolder(args.folder);

    let outcome: UpgradeOutcome | null = null;
    if (!args["folder-only"]) {
      try {
        outcome = await upgradeInstalledVelloo({ checkOnly: dryRun });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // With a folder to migrate, an installation velloo can't replace (a
        // source checkout, an unmarked install) is a note, not a failure —
        // the folder migration is the half that still has work to do.
        if (!folder) fail("upgrade", message);
        console.log(pc.dim(`velloo: skipping the self-upgrade — ${message}`));
      }
    }

    if (!folder) return;

    // The running process is the OLD binary: it can only migrate to the schema
    // version it was compiled with. Hand the folder half to the build that was
    // just installed, which is the one that knows the newer format.
    if (outcome?.upgraded) {
      const bin = installedVellooBin();
      if (bin) {
        const argv = [
          bin,
          "upgrade",
          folder,
          "--folder-only",
          ...(args.skills ? [] : ["--no-skills"]),
        ];
        const code = await Bun.spawn(argv, {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          env: { ...process.env, VELLOO_DISABLE_UPDATE_CHECK: "1" },
        }).exited;
        if (code !== 0) fail("upgrade", `the upgraded velloo could not migrate ${folder}`);
        return;
      }
      console.log(
        pc.dim(
          `velloo: could not locate the upgraded velloo — run \`velloo upgrade ${folder}\` again to migrate the folder.`,
        ),
      );
      return;
    }

    await migrateFolder(folder, { dryRun, skills: args.skills });
  },
});

async function migrateFolder(
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
      progress.step("stopping running canvas");
      stopped = await stopDaemon(daemonRoot(folder));
    }
    progress.step(dryRun ? "checking design folder" : "upgrading design folder");
    result = await upgradeFolder(folder, { dryRun });
  } catch (err) {
    progress.fail("upgrade failed");
    fail("upgrade", err instanceof Error ? err.message : String(err));
  }

  let refreshed: string[] = [];
  try {
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
  } else {
    const verb = dryRun ? "would migrate" : "migrated";
    console.log(`velloo: ${verb} ${folder} from schema version ${result.from} to ${result.to}:`);
    for (const step of result.applied) console.log(`  - ${step}`);
    for (const file of result.changedFiles) console.log(`  ${dryRun ? "~" : "✓"} ${file}`);
    if (!dryRun) console.log("velloo: folder validated against the current schemas.");
  }

  if (refreshed.length > 0) {
    console.log("");
    console.log(pc.green("✓ Refreshed agent guidance to this velloo:"));
    for (const line of refreshed) console.log(`    ${pc.cyan(line)}`);
  }
}
