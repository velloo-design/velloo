import { resolve } from "node:path";
import type { DesignFolder } from "../design-folder.ts";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import type { AgentLaunch } from "./adapter.ts";

/** The MCP server name a session sees Velloo under, matching what `velloo connect` writes. */
const VELLOO_MCP_NAME = "velloo";

/**
 * Where a session works: the app the design belongs to, so the same agent
 * that edits the design can implement it. A design bound to an `app:` root
 * with no checkout here falls back to the folder's parent.
 */
function agentCwd(folder: DesignFolder): string {
  try {
    return hostAppRootFrom(folder.root, folder.config.hostApp);
  } catch {
    return resolve(folder.root, "..");
  }
}

/**
 * The launch a session gets. The MCP endpoint is this daemon's own, so the
 * agent edits the exact design open in the canvas, through the same mutation
 * layer, watcher and history as everyone else — and a session never starts a
 * second daemon.
 */
export function agentLaunchFor(
  folder: DesignFolder,
  mcpUrl: string | undefined,
  mcpCommand: string[] | undefined,
): Omit<AgentLaunch, "resume"> {
  return {
    cwd: agentCwd(folder),
    ...(mcpUrl
      ? {
          mcp: {
            name: VELLOO_MCP_NAME,
            url: mcpUrl,
            ...(mcpCommand ? { command: mcpCommand } : {}),
          },
        }
      : {}),
    instructions: [
      `You are running inside the Velloo canvas, in its Agent tab, beside the design "${folder.config.name}" at ${folder.root}.`,
      `The "${VELLOO_MCP_NAME}" MCP server is that design: change it only through its tools, never by editing the design folder's files.`,
      "The person sees every design edit render on the canvas as you make it.",
      "When a message names canvas context (a board, screen, frame, node, preview or comment), it refers to this design.",
    ].join(" "),
  };
}
