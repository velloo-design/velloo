import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  MCP_SURFACE_MODES,
  parseMcpSurfaceSelection,
  recordedDesignName,
  runStdioFormatGate,
  runStdioMcpProxy,
  withMcpSessionUrl,
  withMcpSurfaceUrl,
} from "@velloo/server";
import { defineCommand } from "citty";
import {
  DesignFolderFormatError,
  daemonRoot,
  ensureDaemon,
  stopDaemon,
} from "../daemon/runtime.ts";
import { DESIGN_ARG_DESCRIPTION, resolveDesignForSession, trySessionDesign } from "../design.ts";
import { fail } from "../fail.ts";
import { assertLoopbackHost } from "../host-security.ts";
import { traceEnabled } from "../trace/env.ts";
import { upgradeFolder } from "../upgrade-folder.ts";
import { TOOL_VERSION } from "../version.ts";

type SessionStart = Awaited<ReturnType<typeof resolveDesignForSession>>;

/**
 * The design a session opens on, looked for where the agent might be: the
 * directory we were started in, then the project Claude Code names for its
 * plugins (CLAUDE_PROJECT_DIR — a plugin's server starts in the plugin's own
 * folder). Null when neither holds one and an agent is on the other end: the
 * session then starts unbound and the agent opens a design by path. Run by
 * hand in a terminal, the usual error still applies.
 */
async function sessionStart(arg: string | undefined, http: boolean): Promise<SessionStart | null> {
  if (arg) return resolveDesignForSession(arg, "mcp");
  const here = await trySessionDesign(".");
  if (!("error" in here)) return here;
  const project = process.env.CLAUDE_PROJECT_DIR;
  if (project && resolve(project) !== resolve(".") && existsSync(project)) {
    const there = await trySessionDesign(project);
    if (!("error" in there)) return there;
  }
  if (http || process.stdin.isTTY) fail("mcp", here.error);
  return null;
}

/** How the agent should run the CLI: by name when installed, else through npx. */
function cliCommand(): string {
  return Bun.which("velloo") ? "velloo" : `npx -y velloo@${TOOL_VERSION.split(" ")[0]}`;
}

function noDesignMessage(path: string, reason: string): string {
  const cli = cliCommand();
  return (
    `No Velloo design in ${path}: ${reason}\n\n` +
    `If the user wants one, create it with \`${cli} init\` run in ${path} (it opens a setup ` +
    `page in the browser; add \`--nonInteractive\` to take the defaults), then call ` +
    "`open_design` again. Ask the user before creating it."
  );
}

/**
 * The agent that spawned us can't read a failed process's stderr — it would
 * just see a dead MCP server. So a design-folder format mismatch doesn't exit:
 * it serves a minimal MCP session whose instructions explain the mismatch and
 * (for a folder older than this binary) expose `upgrade_design_folder`, so the
 * agent can migrate the folder and reconnect.
 */
async function serveFormatGate(err: DesignFolderFormatError): Promise<never> {
  console.error(`velloo mcp: ${err.message.slice("velloo: ".length)}`);
  console.error("velloo mcp: serving the upgrade gate over MCP instead of the design tools.");

  let closing = false;
  const shutdown = async (close?: () => Promise<void>) => {
    if (closing) return;
    closing = true;
    await close?.();
    process.exit(0);
  };
  const gate = await runStdioFormatGate({
    root: err.root,
    found: err.found,
    current: err.current,
    upgrade:
      err.found < err.current
        ? async () => {
            // Same order as `velloo upgrade`: a live daemon (an older binary
            // still reading this format) would race the rewrite — stop it first.
            await stopDaemon(daemonRoot(err.root));
            return upgradeFolder(err.root);
          }
        : undefined,
    onExit: () => void shutdown(),
  });
  process.on("SIGINT", () => void shutdown(gate.close));
  process.on("SIGTERM", () => void shutdown(gate.close));
  process.stdin.on("end", () => void shutdown(gate.close));
  process.stdin.on("close", () => void shutdown(gate.close));

  return await new Promise<never>(() => {});
}

export default defineCommand({
  meta: {
    name: "mcp",
    description:
      "Connect this agent to the folder's canvas over MCP (stdio by default). Usually spawned by your agent.",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: DESIGN_ARG_DESCRIPTION,
    },
    http: {
      type: "boolean",
      default: false,
      description: "Print the daemon's HTTP MCP URL instead of bridging over stdio",
    },
    port: {
      type: "string",
      description: "Preferred canvas port when starting the daemon fresh (default 7300)",
    },
    host: {
      type: "string",
      description: "Loopback bind hostname: 127.0.0.1 (default), localhost or ::1",
    },
    surface: {
      type: "string",
      description: `Tool surface: ${MCP_SURFACE_MODES.join(", ")} (default guided; env VELLOO_MCP_SURFACE)`,
    },
    "in-canvas": {
      type: "boolean",
      default: false,
      description: "Set by the canvas's Agent tab: the agent runs inside the canvas",
    },
  },
  async run({ args }) {
    assertLoopbackHost(args.host ?? "127.0.0.1");
    const start = await sessionStart(args.design, args.http);
    const preferredPort = args.port ? Number(args.port) : undefined;
    const parsedSurface = parseMcpSurfaceSelection(args.surface ?? process.env.VELLOO_MCP_SURFACE);
    if (!parsedSurface.ok) throw new Error(`velloo mcp: ${parsedSurface.error}`);
    const surface = parsedSurface.selection;

    // Every `velloo mcp` (and `velloo run`) for a folder converges on one
    // persistent canvas daemon — one writer, one canvas URL shared by all
    // agents. We attach to it, spawning a detached one if none is alive.
    let spawned = false;
    let rec: Awaited<ReturnType<typeof ensureDaemon>> | null = null;
    if (start) {
      try {
        rec = await ensureDaemon(start.folder, {
          preferredPort,
          host: args.host,
          onSpawn: () => {
            spawned = true;
          },
        });
      } catch (err) {
        if (err instanceof DesignFolderFormatError && !args.http) await serveFormatGate(err);
        // Anything else (and --http mode) surfaces as one clean CLI error line.
        throw err;
      }
    }

    // Diagnostics to stderr only (stdout is the JSON-RPC stream). The recorder
    // runs in the daemon, so it's only active when this command spawned it.
    if (start && traceEnabled()) {
      console.error(
        spawned
          ? `velloo: ⦿ trace recording ON — tapes → ${join(start.folder, ".velloo", "trace")} (view with \`velloo trace\`)`
          : "velloo: VELLOO_TRACE is set, but attached to an already-running canvas — recording is only active if that daemon was started trace-enabled (`velloo stop` then reconnect to force a fresh one).",
      );
    }

    if (args.http && rec) {
      const selectedUrl = withMcpSessionUrl(withMcpSurfaceUrl(rec.mcpUrl, surface), {
        pick: start?.pick,
      });
      console.log(`velloo: canvas at ${rec.canvasUrl}`);
      console.log(`velloo: MCP server at ${selectedUrl} (point your AI agent here)`);
      console.log("velloo: it keeps running in the background — `velloo stop` to stop it.");
      return;
    }

    // stdio: bridge the agent's stdin/stdout to the daemon's HTTP MCP. Keep
    // stdout pristine for the JSON-RPC stream — diagnostics go to stderr.
    console.error(
      rec
        ? `velloo: bridging MCP to the canvas at ${rec.canvasUrl}`
        : "velloo: no design here yet — waiting for the agent to open one by path",
    );

    let closing = false;
    const shutdown = async (close?: () => Promise<void>) => {
      if (closing) return;
      closing = true;
      await close?.();
      process.exit(0);
    };
    // The design this session is bound to — `switch_design` and
    // `open_design` move it.
    let current = start?.folder ?? null;
    // Only the design the session opened on gets the requested port; another
    // design's daemon keeps its own.
    const portFor = (root: string) => (root === start?.folder ? preferredPort : undefined);
    const sessionUrl = (mcpUrl: string, opened: SessionStart["pick"]) =>
      withMcpSessionUrl(withMcpSurfaceUrl(mcpUrl, surface), {
        switchable: true,
        pick: opened,
        inCanvas: args["in-canvas"],
      });
    const proxy = await runStdioMcpProxy(rec ? sessionUrl(rec.mcpUrl, start?.pick) : null, {
      onExit: () => void shutdown(),
      // A crashed daemon respawns on new ephemeral ports; re-run the ensure
      // flow (lockfile → health check → spawn if dead) to find or revive it.
      rediscover: async () => {
        if (!current) return null;
        try {
          const fresh = await ensureDaemon(current, {
            preferredPort: portFor(current),
            host: args.host,
          });
          return sessionUrl(fresh.mcpUrl, undefined);
        } catch {
          return null;
        }
      },
      switchTo: async (root) => {
        try {
          const next = await ensureDaemon(root, { preferredPort: portFor(root), host: args.host });
          current = root;
          return { url: sessionUrl(next.mcpUrl, undefined) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: message.startsWith("velloo: ") ? message.slice(8) : message };
        }
      },
      open: async (path) => {
        const found = await trySessionDesign(path);
        if ("error" in found) return { error: noDesignMessage(path, found.error) };
        try {
          const next = await ensureDaemon(found.folder, { host: args.host });
          current = found.folder;
          return {
            url: sessionUrl(next.mcpUrl, found.pick),
            name: recordedDesignName(found.folder) ?? basename(found.folder),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: message.startsWith("velloo: ") ? message.slice(8) : message };
        }
      },
    });
    process.on("SIGINT", () => void shutdown(proxy.close));
    process.on("SIGTERM", () => void shutdown(proxy.close));
    process.stdin.on("end", () => void shutdown(proxy.close));
    process.stdin.on("close", () => void shutdown(proxy.close));

    await new Promise<void>(() => {});
  },
});
