import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * The stdio MCP session served when the design folder's on-disk format doesn't
 * match the binary, so the real canvas daemon refuses to boot. An agent that
 * spawned `velloo mcp` never sees a failed process's stderr — it just sees a
 * dead MCP server — so instead of exiting we serve this minimal session: the
 * `initialize` instructions explain the mismatch, and (when the folder is
 * older than the binary) an `upgrade_design_folder` tool lets the agent run
 * the migration itself, then reconnect for the real tools.
 */

export interface FormatGateUpgradeResult {
  from: number;
  to: number;
  /** Human summaries of the migration steps that ran. Empty ⇒ already current. */
  applied: string[];
  changedFiles: string[];
}

export interface StdioFormatGateOptions {
  root: string;
  /** Format version found on disk vs. the one this binary reads. */
  found: number;
  current: number;
  /**
   * Run the on-disk migration (the CLI's `velloo upgrade`: stop any daemon,
   * rewrite, validate). Only offered when the folder is OLDER than the binary;
   * a folder from the future can't be migrated backwards.
   */
  upgrade?: () => Promise<FormatGateUpgradeResult>;
  /** Fires when the session ends (agent disconnects) so the caller can exit. */
  onExit?: () => void;
}

export interface StdioFormatGateHandle {
  close(): Promise<void>;
}

function gateInstructions(opts: StdioFormatGateOptions): string {
  const mismatch =
    `Velloo could not open the design folder at ${opts.root}: it is on design-folder ` +
    `format v${opts.found}, but this velloo reads v${opts.current}. The canvas and all ` +
    `design tools are unavailable until that is resolved — this session only carries ` +
    `this notice${opts.upgrade ? " and the migration tool" : ""}.`;
  const fix = opts.upgrade
    ? `To fix it, call the \`upgrade_design_folder\` tool — it migrates the folder in ` +
      `place, exactly like running \`velloo upgrade ${opts.root}\` in a shell (which also ` +
      `works, if you prefer). After it succeeds, reconnect this MCP server (restart it ` +
      `in your client) to load the design tools.`
    : `The folder was written by a NEWER velloo than this one — nothing here can migrate ` +
      `it backwards. The velloo CLI itself must be updated (e.g. its global install), ` +
      `then reconnect this MCP server.`;
  return `${mismatch}\n\n${fix}\n\nTell the user what happened and how it was (or must be) resolved.`;
}

export async function runStdioFormatGate(
  opts: StdioFormatGateOptions,
): Promise<StdioFormatGateHandle> {
  const mcp = new McpServer(
    { name: "velloo", version: "0.1.0" },
    { instructions: gateInstructions(opts) },
  );

  const upgrade = opts.upgrade;
  if (upgrade) {
    mcp.registerTool(
      "upgrade_design_folder",
      {
        description:
          `Migrate the design folder at ${opts.root} from format v${opts.found} to ` +
          `v${opts.current} in place — the same migration as \`velloo upgrade\`. ` +
          `After it succeeds, reconnect this MCP server to load the design tools.`,
      },
      async () => {
        try {
          const result = await upgrade();
          const summary =
            result.applied.length === 0
              ? `${opts.root} is already at format v${result.to} — nothing to migrate.`
              : [
                  `Migrated ${opts.root} from format v${result.from} to v${result.to}:`,
                  ...result.applied.map((s) => `- ${s}`),
                  `Files rewritten: ${result.changedFiles.join(", ")}`,
                ].join("\n");
          return {
            content: [
              {
                type: "text",
                text:
                  `${summary}\n\nThe design tools are still not loaded in this session — ` +
                  `reconnect the velloo MCP server now (restart it in your client). If you ` +
                  `cannot trigger a reconnect yourself, ask the user to do it.`,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Upgrade failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await mcp.close().catch(() => undefined);
    opts.onExit?.();
  };
  mcp.server.onclose = () => void close();
  await mcp.connect(new StdioServerTransport());
  return { close };
}
