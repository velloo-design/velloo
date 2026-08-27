import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { defineCommand } from "citty";
import { daemonRoot, stopDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { resolveDesignFolder } from "../folder.ts";
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
      description: "Design folder (default: ./velloo)",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Show what would change without writing",
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
      return;
    }
    const verb = dryRun ? "would migrate" : "migrated";
    console.log(`velloo: ${verb} ${folder} from schema version ${result.from} to ${result.to}:`);
    for (const step of result.applied) console.log(`  - ${step}`);
    for (const file of result.changedFiles) console.log(`  ${dryRun ? "~" : "✓"} ${file}`);
    if (!dryRun) console.log("velloo: folder validated against the current schemas.");
  },
});
