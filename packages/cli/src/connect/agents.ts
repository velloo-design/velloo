/**
 * Supported AI coding agents and how each one registers an MCP server.
 * Every agent uses the `mcpServers.<id>` convention; they differ in the
 * config-file location (project vs the user's home dir) and whether the
 * entry needs an explicit transport `type`.
 */
import { join } from "node:path";

/**
 * How velloo connects: `stdio` (the agent spawns `velloo mcp` itself — the
 * default) or `http` (the agent dials a running server's URL).
 */
export type McpConnection =
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http"; url: string };

export interface AgentTarget {
  id: string;
  label: string;
  scope: "project" | "global";
  /** Agent family — decides which guidance (Claude skill / Cursor rule) to install. */
  family: "claude-code" | "cursor";
  /** Resolve the config file path (under the project root, or the home dir for global). */
  path(projectRoot: string, homeDir: string): string;
  /** The velloo server entry, in this agent's expected shape. */
  entry(conn: McpConnection): Record<string, unknown>;
}

// stdio takes the canonical { command, args } shape for both agents. For HTTP,
// Claude Code wants an explicit transport `type`; Cursor infers it from `url`.
const claudeEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http"
    ? { type: "http", url: conn.url }
    : { command: conn.command, args: conn.args };
const cursorEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http" ? { url: conn.url } : { command: conn.command, args: conn.args };

export const AGENTS: Record<string, AgentTarget> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code (project)",
    scope: "project",
    family: "claude-code",
    path: (root) => join(root, ".mcp.json"),
    entry: claudeEntry,
  },
  cursor: {
    id: "cursor",
    label: "Cursor (project)",
    scope: "project",
    family: "cursor",
    path: (root) => join(root, ".cursor", "mcp.json"),
    entry: cursorEntry,
  },
  "claude-code-global": {
    id: "claude-code-global",
    label: "Claude Code (global)",
    scope: "global",
    family: "claude-code",
    path: (_root, home) => join(home, ".claude.json"),
    entry: claudeEntry,
  },
  "cursor-global": {
    id: "cursor-global",
    label: "Cursor (global)",
    scope: "global",
    family: "cursor",
    path: (_root, home) => join(home, ".cursor", "mcp.json"),
    entry: cursorEntry,
  },
};

export const AGENT_IDS = Object.keys(AGENTS);

/** The default set wired without an explicit choice — project scope only. */
export const PROJECT_AGENT_IDS = ["claude-code", "cursor"];
