import { join } from "node:path";
import { defineCommand } from "citty";
import { ensureDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { resolveDesignFolder } from "../folder.ts";
import { openUrl } from "../open-url.ts";
import { traceEnabled } from "../trace/env.ts";

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
    const folder = await resolveDesignFolder(args.folder, "run", { interactive: true });
    const preferredPort = args.port ? Number(args.port) : undefined;
    if (preferredPort !== undefined && (!Number.isFinite(preferredPort) || preferredPort < 0)) {
      fail("run", `invalid --port ${JSON.stringify(args.port)}`);
    }

    // Attach to the folder's persistent canvas daemon, spawning a detached one
    // if none is alive. It outlives this command (and any agent session) and
    // auto-stops only after 5 min with nothing connected (no canvas tab, no
    // agent). A failure (format gate, daemon dying at boot) escapes to the
    // registry guard, which prints it as one clean `velloo run:` line.
    let spawned = false;
    const rec = await ensureDaemon(folder, {
      preferredPort,
      host: args.host,
      onSpawn: () => {
        spawned = true;
      },
    });

    const folderArg = args.folder ? ` ${args.folder}` : "";
    console.log(`velloo: canvas at ${rec.canvasUrl}`);
    console.log(
      `velloo: it keeps running in the background — awake while the canvas is open or an agent is connected; it only sleeps after 5 min with nothing attached, and the next \`velloo run\`/agent connection wakes it. Stop it anytime with \`velloo stop${folderArg}\`.`,
    );

    // The recorder lives in the daemon and reads VELLOO_TRACE at spawn time, so
    // it only takes effect on a daemon *this* command spawned — be explicit
    // about which case happened rather than silently doing nothing.
    if (traceEnabled()) {
      if (spawned) {
        console.log(
          `velloo: ⦿ trace recording ON — agent MCP calls tape to ${join(folder, ".velloo", "trace")} (view with \`velloo trace\`)`,
        );
      } else {
        console.log(
          `velloo: VELLOO_TRACE is set, but a canvas was already running — recording is NOT active on it. Run \`velloo stop${folderArg}\`, then re-run to record. The agent must also connect through this same (trace-enabled) velloo.`,
        );
      }
    }

    if (args.open !== false) await openUrl(rec.canvasUrl);
    // Return to the shell; the daemon stays up.
  },
});
