import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { defineCommand } from "citty";
import pc from "picocolors";
import { refreshAgentArtifacts } from "../connect/index.ts";
import { resolveProjectRoot } from "../connect/project-root.ts";
import { daemonRoot, stopDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";
import { createProgress } from "../progress.ts";
import { upgradeInstalledVelloo } from "../update.ts";
import { upgradeFolder } from "../upgrade-folder.ts";

export default defineCommand({
  meta: {
    name: "upgrade",
    description: "Upgrade Velloo, or migrate a design folder when one is supplied",
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
    skills: {
      type: "boolean",
      default: true,
      description:
        "Also refresh the installed agent skills / plugin / rules to this velloo's versions",
    },
  },
  async run({ args }) {
    if (!args.folder) {
      try {
        await upgradeInstalledVelloo({ checkOnly: args.check || args["dry-run"] });
      } catch (error) {
        fail("upgrade", error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const folder = await resolveDesignFolder(args.folder, "upgrade", { requireConfig: true });
    const dryRun = args["dry-run"] || args.check;
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
      if (args.skills && !dryRun) {
        progress.step("refreshing agent guidance");
        const projectRoot = await resolveProjectRoot(folder);
        ({ refreshed } = await refreshAgentArtifacts({ projectRoot, designFolder: folder }));
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
  },
});
