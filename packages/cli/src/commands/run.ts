import { defineCommand } from "citty";
import { ensureDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { resolveDesignFolder } from "../folder.ts";
import { openUrl } from "../open-url.ts";

export default defineCommand({
  meta: {
    name: "run",
    description:
      "Open the canvas for a design folder (starts a persistent canvas if none is running)",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: "Design folder (default: ./velloo)",
    },
    port: {
      type: "string",
      description: "Preferred canvas port when starting fresh (default 7300, else a free port)",
    },
    host: {
      type: "string",
      description: "Bind hostname (default 127.0.0.1)",
    },
    open: {
      type: "boolean",
      default: true,
      description: "Open the canvas in your browser (use --no-open to skip)",
    },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "run");
    const preferredPort = args.port ? Number(args.port) : undefined;
    if (preferredPort !== undefined && (!Number.isFinite(preferredPort) || preferredPort < 0)) {
      fail("run", `invalid --port ${JSON.stringify(args.port)}`);
    }

    // Attach to the folder's persistent canvas daemon, spawning a detached one
    // if none is alive. It outlives this command (and any agent session) and
    // auto-stops after 5 min idle.
    let rec: Awaited<ReturnType<typeof ensureDaemon>>;
    try {
      rec = await ensureDaemon(folder, { preferredPort, host: args.host });
    } catch (err) {
      fail("run", (err as Error).message);
    }

    const folderArg = args.folder ? ` ${args.folder}` : "";
    console.log(`velloo: canvas at ${rec.canvasUrl}`);
    console.log(
      `velloo: it keeps running in the background — stop it with \`velloo stop${folderArg}\` (auto-stops after 5 min idle)`,
    );

    if (args.open !== false) await openUrl(rec.canvasUrl);
    // Return to the shell; the daemon stays up.
  },
});
