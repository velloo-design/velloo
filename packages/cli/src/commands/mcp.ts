import { runStdioMcpProxy } from "@velloo/server";
import { defineCommand } from "citty";
import { ensureDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { resolveDesignFolder } from "../folder.ts";

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
      description: "Design folder (default: ./velloo, else the nearest .design above the cwd)",
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
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "mcp");
    const preferredPort = args.port ? Number(args.port) : undefined;

    // Every `velloo mcp` (and `velloo run`) for a folder converges on one
    // persistent canvas daemon — one writer, one canvas URL shared by all
    // agents. We attach to it, spawning a detached one if none is alive.
    let rec: Awaited<ReturnType<typeof ensureDaemon>>;
    try {
      rec = await ensureDaemon(folder, { preferredPort, host: args.host });
    } catch (err) {
      fail("mcp", (err as Error).message);
    }

    if (args.http) {
      console.log(`velloo: canvas at ${rec.canvasUrl}`);
      console.log(`velloo: MCP server at ${rec.mcpUrl} (point your AI agent here)`);
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
    const proxy = await runStdioMcpProxy(rec.mcpUrl, () => void shutdown());
    process.on("SIGINT", () => void shutdown(proxy.close));
    process.on("SIGTERM", () => void shutdown(proxy.close));
    process.stdin.on("end", () => void shutdown(proxy.close));
    process.stdin.on("close", () => void shutdown(proxy.close));

    await new Promise<void>(() => {});
  },
});
