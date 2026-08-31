import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { defineCommand } from "citty";
import pc from "picocolors";
import { refreshAgentArtifacts } from "../connect/index.ts";
import { resolveProjectRoot } from "../connect/project-root.ts";
import { daemonRoot, stopDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";
import { upgradeFolder } from "../upgrade-folder.ts";

export default defineCommand({
  meta: {
    name: "upgrade",
    description: "Migrate a design folder to this velloo's on-disk format",
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
    skills: {
      type: "boolean",
      default: true,
      description:
        "Also refresh the installed agent skills / plugin / rules to this velloo's versions",
    },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "upgrade", { requireConfig: true });
    const dryRun = args["dry-run"];

    if (!dryRun) {
      // A live daemon would race the rewrite (and an old binary can't read the
      // migrated folder anyway) — stop it first, like a real package manager.
      const stopped = await stopDaemon(daemonRoot(folder));
      if (stopped) console.log("velloo: stopped the running canvas for this folder.");
    }

    let result: Awaited<ReturnType<typeof upgradeFolder>>;
    try {
      result = await upgradeFolder(folder, { dryRun });
    } catch (err) {
      fail("upgrade", err instanceof Error ? err.message : String(err));
    }

    if (result.applied.length === 0) {
      console.log(`velloo: ${folder} is already at schema version ${CURRENT_SCHEMA_VERSION}.`);
    } else {
      const verb = dryRun ? "would migrate" : "migrated";
      console.log(`velloo: ${verb} ${folder} from schema version ${result.from} to ${result.to}:`);
      for (const step of result.applied) console.log(`  - ${step}`);
      for (const file of result.changedFiles) console.log(`  ${dryRun ? "~" : "✓"} ${file}`);
      if (!dryRun) console.log("velloo: folder validated against the current schemas.");
    }

    // The skills and the plugin ship with the binary, so a new velloo means new
    // guidance — and a stale skill is worse than a missing one, since it keeps
    // confidently describing tools that changed underneath it. Refresh what's
    // installed; wiring something new stays `velloo connect`.
    if (args.skills && !dryRun) {
      const projectRoot = await resolveProjectRoot(folder);
      const { refreshed } = await refreshAgentArtifacts({ projectRoot, designFolder: folder });
      if (refreshed.length > 0) {
        console.log("");
        console.log(pc.green("✓ Refreshed agent guidance to this velloo:"));
        for (const line of refreshed) console.log(`    ${pc.cyan(line)}`);
      }
    }
  },
});
