import { basename, join } from "node:path";
import { recordedDesignName } from "@velloo/server";
import { defineCommand } from "citty";
import pc from "picocolors";
import {
  type DaemonRecord,
  daemonRoot,
  ensureDaemon,
  isLive,
  stopDaemon,
} from "../daemon/runtime.ts";
import { DESIGN_ARG_DESCRIPTION } from "../design.ts";
import { designWithFolder } from "../design-label.ts";
import { fail } from "../fail.ts";
import { assertLoopbackHost } from "../host-security.ts";
import { openUrl } from "../open-url.ts";
import { createProgress } from "../progress.ts";
import { shouldStayForeground, waitInForeground } from "../run-foreground.ts";
import { type RunTarget, resolveRunTargets } from "../run-targets.ts";
import { traceEnabled } from "../trace/env.ts";

/** The design's name as its config says now (it may have been renamed), else the folder's. */
function label(target: RunTarget): string {
  return recordedDesignName(target.folder) ?? target.name ?? basename(target.folder);
}

interface Attached {
  target: RunTarget;
  rec: DaemonRecord;
}

function printKeys(attached: Attached[]): void {
  console.log("");
  if (attached.length > 1) {
    attached.forEach(({ target }, i) => {
      console.log(`  ${pc.cyan(String(i + 1))}  open ${label(target)}`);
    });
    console.log(`  ${pc.cyan("a")}  open all`);
  } else {
    console.log(`  ${pc.cyan("o")}  open the browser`);
  }
  console.log(`  ${pc.cyan("b")}  run in the background`);
  console.log(`  ${pc.cyan("q")}  stop`);
  console.log("");
}

function printBackgroundStay(designArg: string): void {
  console.log(
    `velloo: it keeps running in the background — awake while the canvas is open or an agent is connected. Stop it anytime with \`velloo stop${designArg}\`.`,
  );
}

export default defineCommand({
  meta: {
    name: "run",
    description:
      "Open the canvas for a design folder and stay in the foreground (starts a persistent canvas if none is running)",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: DESIGN_ARG_DESCRIPTION,
    },
    port: {
      type: "string",
      description:
        "Preferred canvas port when starting fresh (default: the port this folder ran on last, else 7300)",
    },
    host: {
      type: "string",
      description: "Loopback bind hostname: 127.0.0.1 (default), localhost or ::1",
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
    assertLoopbackHost(args.host ?? "127.0.0.1");
    const targets = await resolveRunTargets(args.design, {});
    const preferredPort = args.port ? Number(args.port) : undefined;
    if (preferredPort !== undefined && (!Number.isFinite(preferredPort) || preferredPort < 0)) {
      fail("run", `invalid --port ${JSON.stringify(args.port)}`);
    }

    // Attach to each folder's persistent canvas daemon, spawning a detached
    // one where none is alive. They outlive this command (and any agent
    // session) and auto-stop only after 5 min with nothing connected (no
    // canvas tab, no agent). A failure (format gate, daemon dying at boot)
    // escapes to the registry guard, which prints it as one clean
    // `velloo run:` line.
    const progress = createProgress();
    progress.start(targets.length > 1 ? "starting canvases" : "starting canvas");
    let spawned = 0;
    const running: { target: RunTarget; rec: Awaited<ReturnType<typeof ensureDaemon>> }[] = [];
    try {
      for (const [index, target] of targets.entries()) {
        if (targets.length > 1) progress.step(`starting ${label(target)}`);
        const rec = await ensureDaemon(target.folder, {
          // An explicit --port belongs to the first canvas; the rest take
          // their own ports rather than fighting over one number.
          ...(preferredPort !== undefined && index === 0 ? { preferredPort } : {}),
          host: args.host,
          onSpawn: () => {
            spawned++;
            progress.step(`waiting for ${label(target)}`);
          },
        });
        running.push({ target, rec });
      }
      progress.succeed(
        spawned === 0
          ? targets.length > 1
            ? "connected to running canvases"
            : "connected to running canvas"
          : targets.length > 1
            ? `started ${targets.length} canvases`
            : "started canvas",
      );
    } catch (error) {
      progress.fail("could not start canvas");
      throw error;
    }

    const designArg = args.design ? ` ${args.design}` : "";
    const first = running[0] as {
      target: RunTarget;
      rec: Awaited<ReturnType<typeof ensureDaemon>>;
    };
    if (running.length === 1) {
      console.log(`velloo: design ${designWithFolder(first.target.folder, first.target.name)}`);
      console.log(`velloo: canvas at ${first.rec.canvasUrl}`);
    } else {
      console.log("velloo: canvases");
      const rows = running.map(({ target, rec }) => ({
        design: designWithFolder(target.folder, target.name),
        url: rec.canvasUrl,
      }));
      const width = Math.max(...rows.map((row) => row.design.length));
      for (const row of rows) console.log(`  ${pc.bold(row.design.padEnd(width))}  ${row.url}`);
    }

    // The recorder lives in the daemon and reads VELLOO_TRACE at spawn time, so
    // it only takes effect on a daemon *this* command spawned — be explicit
    // about which case happened rather than silently doing nothing.
    if (traceEnabled()) {
      if (spawned > 0) {
        console.log(
          `velloo: ⦿ trace recording ON — agent MCP calls tape to ${join(first.target.folder, ".velloo", "trace")} (view with \`velloo trace\`)`,
        );
      } else {
        console.log(
          `velloo: VELLOO_TRACE is set, but a canvas was already running — recording is NOT active on it. Run \`velloo stop${designArg}\`, then re-run to record. The agent must also connect through this same (trace-enabled) velloo.`,
        );
      }
    }

    const foreground = shouldStayForeground({
      background: Boolean(args.background),
      stdinIsTTY: Boolean(process.stdin.isTTY),
    });

    if (foreground) printKeys(running);
    else printBackgroundStay(designArg);

    // The canvases this session still holds. One stopping — by `velloo stop`
    // or a command that has to restart it (move, bind, upgrade) in another
    // window — drops out of the list; the session ends when none are left.
    let attached: Attached[] = running;
    const openTarget = (index?: number) => {
      const picked = index === undefined ? attached : [attached[index - 1]];
      for (const entry of picked) if (entry) void openUrl(entry.rec.canvasUrl);
    };

    if (args.open) openTarget(running.length > 1 ? undefined : 1);
    if (!foreground) return;

    for (;;) {
      const outcome = await waitInForeground({
        isLive: async () => {
          for (const { rec } of attached) if (!(await isLive(rec))) return false;
          return true;
        },
        onOpen: openTarget,
        targetCount: attached.length,
      });

      if (outcome === "background") {
        printBackgroundStay(designArg);
        return;
      }

      if (outcome === "died") {
        const alive: Attached[] = [];
        for (const entry of attached) {
          if (await isLive(entry.rec)) alive.push(entry);
          else console.log(`velloo: the canvas for "${label(entry.target)}" stopped.`);
        }
        attached = alive;
        if (attached.length === 0) {
          console.log(`velloo: no canvases left. Start again with \`velloo run${designArg}\`.`);
          return;
        }
        console.log(
          pc.dim(`  Still running: ${attached.map(({ target }) => label(target)).join(", ")}.`),
        );
        printKeys(attached);
        continue;
      }

      for (const { target } of attached) {
        const stopped = await stopDaemon(daemonRoot(target.folder));
        console.log(
          stopped
            ? `velloo: stopped ${designWithFolder(target.folder)}`
            : `velloo: no canvas running for ${designWithFolder(target.folder)}`,
        );
      }
      return;
    }
  },
});
