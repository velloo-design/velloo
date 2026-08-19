import { defineCommand } from "citty";
import { daemonRoot, listDaemons, stopDaemon } from "../daemon/runtime.ts";
import { resolveDesignFolder } from "../folder.ts";

export default defineCommand({
  meta: {
    name: "stop",
    description: "Stop the persistent canvas daemon for a folder (or --all)",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: "Design folder (default: ./velloo)",
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
    const stopped = await stopDaemon(root);
    console.log(
      stopped ? `velloo: stopped canvas for ${root}` : `velloo: no canvas running for ${root}`,
    );
  },
});
