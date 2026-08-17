import { resolve } from "node:path";
import { createServer } from "@velloo/server";
import { defineCommand } from "citty";
import { fail } from "../fail.ts";

export default defineCommand({
  meta: {
    name: "run",
    description: "Start the canvas server pointed at a design folder",
  },
  args: {
    folder: { type: "positional", required: true, description: "Design folder" },
    port: {
      type: "string",
      description: "Port for the canvas server (default 7300)",
    },
    "mcp-port": {
      type: "string",
      description: "Port for the MCP server (default 7301)",
    },
    host: {
      type: "string",
      description: "Bind hostname (default 127.0.0.1)",
    },
  },
  async run({ args }) {
    const folder = resolve(args.folder);
    const port = args.port ? Number(args.port) : 7300;
    if (!Number.isFinite(port) || port <= 0) {
      fail("run", `invalid --port ${JSON.stringify(args.port)}`);
    }
    const mcpPort = args["mcp-port"] ? Number(args["mcp-port"]) : 7301;
    if (!Number.isFinite(mcpPort) || mcpPort <= 0) {
      fail("run", `invalid --mcp-port ${JSON.stringify(args["mcp-port"])}`);
    }

    const handle = await createServer({
      folder,
      port,
      mcpPort,
      host: args.host ?? "127.0.0.1",
    });
    console.log(`velloo: canvas at ${handle.url}`);
    console.log(`velloo: MCP server at ${handle.mcpUrl} (point your AI agent here)`);
    console.log("(Ctrl-C to stop)");

    const shutdown = async () => {
      await handle.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process alive.
    await new Promise<void>(() => {});
  },
});
