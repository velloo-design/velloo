import { join } from "node:path";
import {
  MCP_PROFILE_IDS,
  MCP_SURFACE_MODES,
  parseMcpSurfaceSelection,
  runStdioFormatGate,
  runStdioMcpProxy,
  withMcpSurfaceUrl,
} from "@velloo/server";
import { defineCommand } from "citty";
import {
  DesignFolderFormatError,
  daemonRoot,
  ensureDaemon,
  stopDaemon,
} from "../daemon/runtime.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";
import { traceEnabled } from "../trace/env.ts";
import { upgradeFolder } from "../upgrade-folder.ts";

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
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
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
      description: "Bind hostname (default 127.0.0.1)",
    },
    surface: {
      type: "string",
      description: `Tool surface: ${MCP_SURFACE_MODES.join(", ")} (default guided; env VELLOO_MCP_SURFACE)`,
    },
    profile: {
      type: "string",
      description: `Optional workflow profile: ${MCP_PROFILE_IDS.join(", ")} (env VELLOO_MCP_PROFILE)`,
    },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "mcp");
    const preferredPort = args.port ? Number(args.port) : undefined;
    const parsedSurface = parseMcpSurfaceSelection(
      args.surface ?? process.env.VELLOO_MCP_SURFACE,
      args.profile ?? process.env.VELLOO_MCP_PROFILE,
    );
    if (!parsedSurface.ok) throw new Error(`velloo mcp: ${parsedSurface.error}`);
    const surface = parsedSurface.selection;

    // Every `velloo mcp` (and `velloo run`) for a folder converges on one
    // persistent canvas daemon — one writer, one canvas URL shared by all
    // agents. We attach to it, spawning a detached one if none is alive.
    let spawned = false;
    let rec: Awaited<ReturnType<typeof ensureDaemon>>;
    try {
      rec = await ensureDaemon(folder, {
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

    // Diagnostics to stderr only (stdout is the JSON-RPC stream). The recorder
    // runs in the daemon, so it's only active when this command spawned it.
    if (traceEnabled()) {
      console.error(
        spawned
          ? `velloo: ⦿ trace recording ON — tapes → ${join(folder, ".velloo", "trace")} (view with \`velloo trace\`)`
          : "velloo: VELLOO_TRACE is set, but attached to an already-running canvas — recording is only active if that daemon was started trace-enabled (`velloo stop` then reconnect to force a fresh one).",
      );
    }

    if (args.http) {
      const selectedUrl = withMcpSurfaceUrl(rec.mcpUrl, surface);
      console.log(`velloo: canvas at ${rec.canvasUrl}`);
      console.log(`velloo: MCP server at ${selectedUrl} (point your AI agent here)`);
      console.log("velloo: it keeps running in the background — `velloo stop` to stop it.");
      return;
    }

    // stdio: bridge the agent's stdin/stdout to the daemon's HTTP MCP. Keep
    // stdout pristine for the JSON-RPC stream — diagnostics go to stderr.
    console.error(`velloo: bridging MCP to the canvas at ${rec.canvasUrl}`);

    let closing = false;
    const shutdown = async (close?: () => Promise<void>) => {
      if (closing) return;
      closing = true;
      await close?.();
      process.exit(0);
    };
    const proxy = await runStdioMcpProxy(withMcpSurfaceUrl(rec.mcpUrl, surface), {
      onExit: () => void shutdown(),
      // A crashed daemon respawns on new ephemeral ports; re-run the ensure
      // flow (lockfile → health check → spawn if dead) to find or revive it.
      rediscover: async () => {
        try {
          const fresh = await ensureDaemon(folder, { preferredPort, host: args.host });
          return withMcpSurfaceUrl(fresh.mcpUrl, surface);
        } catch {
          return null;
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
