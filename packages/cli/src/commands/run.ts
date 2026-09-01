import { join } from "node:path";
import { defineCommand } from "citty";
import pc from "picocolors";
import { daemonRoot, ensureDaemon, isLive, stopDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";
import { openUrl } from "../open-url.ts";
import { shouldStayForeground, waitInForeground } from "../run-foreground.ts";
import { traceEnabled } from "../trace/env.ts";

function printBackgroundStay(folderArg: string): void {
  console.log(
    `velloo: it keeps running in the background — awake while the canvas is open or an agent is connected. Stop it anytime with \`velloo stop${folderArg}\`.`,
  );
}

export default defineCommand({
  meta: {
    name: "run",
    description:
      "Open the canvas for a design folder and stay in the foreground (starts a persistent canvas if none is running)",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
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
      default: false,
      description: "Open the canvas in your browser",
    },
    background: {
      type: "boolean",
      default: false,
      description:
        "Leave the canvas running and return to the shell (the default when stdin is not a TTY)",
    },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "run", {
      interactive: true,
      requireConfig: true,
    });
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
    const root = daemonRoot(folder);
    console.log(`velloo: canvas at ${rec.canvasUrl}`);

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

    const foreground = shouldStayForeground({
      background: Boolean(args.background),
      stdinIsTTY: Boolean(process.stdin.isTTY),
    });

    if (foreground) {
      console.log("");
      console.log(`  ${pc.cyan("b")}  run in the background`);
      console.log(`  ${pc.cyan("s")}  stop`);
      console.log(`  ${pc.cyan("o")}  open the browser`);
      console.log("");
    } else {
      printBackgroundStay(folderArg);
    }

    if (args.open) await openUrl(rec.canvasUrl);
    if (!foreground) return;

    const outcome = await waitInForeground({
      isLive: () => isLive(rec),
      onOpen: () => {
        void openUrl(rec.canvasUrl);
      },
    });

    if (outcome === "background") {
      printBackgroundStay(folderArg);
      return;
    }
    if (outcome === "died") {
      console.log("velloo: canvas exited.");
      return;
    }

    const stopped = await stopDaemon(root);
    console.log(
      stopped ? `velloo: stopped canvas for ${root}` : `velloo: no canvas running for ${root}`,
    );
  },
});
