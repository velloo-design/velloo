/**
 * Supported AI coding agents and how each one registers an MCP server.
 * Every agent here uses the `mcpServers.<id>` convention; they differ only
 * in config-file location and whether the entry needs an explicit
 * transport `type`. Adding an agent is one entry — no other changes.
 */
export interface AgentTarget {
  id: string;
  label: string;
  /** Config file path relative to the project root. */
  relPath: string;
  /** The velloo server entry, in this agent's expected shape. */
  entry(mcpUrl: string): Record<string, unknown>;
}

export const AGENTS: Record<string, AgentTarget> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    relPath: ".mcp.json",
    // Claude Code wants an explicit transport type for remote servers.
    entry: (mcpUrl) => ({ type: "http", url: mcpUrl }),
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    relPath: ".cursor/mcp.json",
    // Cursor infers HTTP/SSE transport from the presence of `url`.
    entry: (mcpUrl) => ({ url: mcpUrl }),
  },
};

export const AGENT_IDS = Object.keys(AGENTS);
