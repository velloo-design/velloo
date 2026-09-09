import { defineCommand } from "citty";
import pc from "picocolors";
import { daemonRoot, listDaemons, stopDaemon } from "../daemon/runtime.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";
import { projectLabel } from "../manifest.ts";

export default defineCommand({
  meta: {
    name: "stop",
    description: "Stop the persistent canvas daemon for a folder (or --all)",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
    },
    all: {
      type: "boolean",
      default: false,
      description: "Stop every running velloo canvas daemon on this machine",
    },
  },
  async run({ args }) {
    if (args.all) {
      const daemons = await listDaemons();
      if (daemons.length === 0) {
        console.log("velloo: no canvas daemons running.");
        return;
      }
      for (const d of daemons) {
        await stopDaemon(d.root);
        console.log(`velloo: stopped ${d.canvasUrl} (${d.root})`);
      }
      return;
    }

    const folder = await resolveDesignFolder(args.folder, "stop");
    const root = daemonRoot(folder);
    if (await stopDaemon(root)) {
      console.log(`velloo: stopped canvas for ${root}`);
      return;
    }

    // `stop` is folder-scoped and `status` is machine-wide, so a bare `stop`
    // run from the wrong folder used to report "nothing running" about a
    // daemon `status` was happily listing. Name the others rather than
    // leaving two notions of ownership to reconcile by hand.
    console.log(`velloo: no canvas running for ${root}`);
    const others = await listDaemons();
    if (others.length === 0) return;
    console.log(
      pc.dim(
        `  ${others.length} canvas${others.length === 1 ? "" : "es"} running elsewhere — stop one by path, or \`velloo stop --all\`:`,
      ),
    );
    for (const d of others) {
      console.log(pc.dim(`    ${d.canvasUrl}  ${(await projectLabel(d.root)) ?? d.root}`));
    }
  },
});
