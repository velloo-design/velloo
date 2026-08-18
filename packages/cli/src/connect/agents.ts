/**
 * Supported AI coding agents and how each one registers an MCP server.
 * Every agent uses the `mcpServers.<id>` convention; they differ in the
 * config-file location (project vs the user's home dir) and whether the
 * entry needs an explicit transport `type`.
 */
import { join } from "node:path";

export interface AgentTarget {
  id: string;
  label: string;
  scope: "project" | "global";
  /** Agent family — decides which guidance (Claude skill / Cursor rule) to install. */
  family: "claude-code" | "cursor";
  /** Resolve the config file path (under the project root, or the home dir for global). */
  path(projectRoot: string, homeDir: string): string;
  /** The velloo server entry, in this agent's expected shape. */
  entry(mcpUrl: string): Record<string, unknown>;
}

// Claude Code wants an explicit transport type for remote servers; Cursor
// infers HTTP/SSE from the presence of `url`.
const claudeEntry = (mcpUrl: string): Record<string, unknown> => ({ type: "http", url: mcpUrl });
const cursorEntry = (mcpUrl: string): Record<string, unknown> => ({ url: mcpUrl });

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
