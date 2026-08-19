import { createServer } from "@velloo/server";
import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import { fail } from "../fail.ts";
import { resolveDesignFolder } from "../folder.ts";

export default defineCommand({
  meta: {
    name: "run",
    description: "Start the canvas server pointed at a design folder",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: "Design folder (default: ./velloo)",
    },
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
    const folder = await resolveDesignFolder(args.folder, "run");
    const port = args.port ? Number(args.port) : 7300;
    if (!Number.isFinite(port) || port <= 0) {
      fail("run", `invalid --port ${JSON.stringify(args.port)}`);
    }
    const mcpPort = args["mcp-port"] ? Number(args["mcp-port"]) : 7301;
    if (!Number.isFinite(mcpPort) || mcpPort <= 0) {
      fail("run", `invalid --mcp-port ${JSON.stringify(args["mcp-port"])}`);
    }

    // The server reads no credentials itself — resolve them here (respecting
    // the server→cli dependency direction) and thread them in. Read once at
    // startup: logging in while the server runs needs a restart. A missing
    // token is fine; the opt-in feedback tool reports it when invoked.
    const cloudUrl = defaultCloudUrl();
    const cred = await loadCredential(cloudUrl);

    const handle = await createServer({
      folder,
      port,
      mcpPort,
      host: args.host ?? "127.0.0.1",
      cloud: { url: cloudUrl, token: cred?.token },
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
