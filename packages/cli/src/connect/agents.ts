/**
 * Supported AI coding agents and how each one registers an MCP server.
 * Claude Code and Cursor use the JSON `mcpServers.<id>` convention; Codex
 * uses TOML (`[mcp_servers.velloo]` in a `config.toml`, project or global —
 * developers.openai.com/codex/mcp); Continue uses YAML (a standalone block
 * file under `.continue/mcpServers/` in a workspace, an `mcpServers` list in
 * the global `~/.continue/config.yaml` — docs.continue.dev/customize/deep-dives/mcp;
 * Continue's legacy `config.json` is deprecated, so velloo writes YAML only).
 * They differ in config location (project vs the user's home dir), file
 * format, and how the entry spells its transport.
 */
import { join } from "node:path";

/**
 * How velloo connects: `stdio` (the agent spawns `velloo mcp` itself — the
 * default) or `http` (the agent dials a running server's URL).
 */
export type McpConnection =
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http"; url: string };

/** How the agent's config file is written — see write-config.ts for each merge. */
export type AgentConfigFormat = "json" | "codex-toml" | "continue-block" | "continue-config";

export interface AgentTarget {
  id: string;
  label: string;
  scope: "project" | "global";
  format: AgentConfigFormat;
  /**
   * Agent family — decides which guidance (Claude skill / Cursor rule) to
   * install. Absent ⇒ no packaged guidance for this agent yet.
   */
  family?: "claude-code" | "cursor";
  /** Resolve the config file path (under the project root, or the home dir for global). */
  path(projectRoot: string, homeDir: string): string;
  /** The velloo server entry, in this agent's expected shape. */
  entry(conn: McpConnection): Record<string, unknown>;
}

// stdio takes the canonical { command, args } shape everywhere. For HTTP,
// Claude Code wants an explicit transport `type`; Cursor and Codex infer it
// from `url`; Continue distinguishes sse vs streamable-http (velloo's HTTP
// MCP is streamable HTTP).
const claudeEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http"
    ? { type: "http", url: conn.url }
    : { command: conn.command, args: conn.args };
const cursorEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http" ? { url: conn.url } : { command: conn.command, args: conn.args };
const codexEntry = cursorEntry;
const continueEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http"
    ? { name: "velloo", type: "streamable-http", url: conn.url }
    : { name: "velloo", type: "stdio", command: conn.command, args: conn.args };

export const AGENTS: Record<string, AgentTarget> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code (project)",
    scope: "project",
    format: "json",
    family: "claude-code",
    path: (root) => join(root, ".mcp.json"),
    entry: claudeEntry,
  },
  cursor: {
    id: "cursor",
    label: "Cursor (project)",
    scope: "project",
    format: "json",
    family: "cursor",
    path: (root) => join(root, ".cursor", "mcp.json"),
    entry: cursorEntry,
  },
  codex: {
    id: "codex",
    label: "Codex CLI (project)",
    scope: "project",
    format: "codex-toml",
    path: (root) => join(root, ".codex", "config.toml"),
    entry: codexEntry,
  },
  continue: {
    id: "continue",
    label: "Continue (project)",
    scope: "project",
    format: "continue-block",
    path: (root) => join(root, ".continue", "mcpServers", "velloo.yaml"),
    entry: continueEntry,
  },
  "claude-code-global": {
    id: "claude-code-global",
    label: "Claude Code (global)",
    scope: "global",
    format: "json",
    family: "claude-code",
    path: (_root, home) => join(home, ".claude.json"),
    entry: claudeEntry,
  },
  "cursor-global": {
    id: "cursor-global",
    label: "Cursor (global)",
    scope: "global",
    format: "json",
    family: "cursor",
    path: (_root, home) => join(home, ".cursor", "mcp.json"),
    entry: cursorEntry,
  },
  "codex-global": {
    id: "codex-global",
    label: "Codex CLI (global)",
    scope: "global",
    format: "codex-toml",
    path: (_root, home) => join(home, ".codex", "config.toml"),
    entry: codexEntry,
  },
  "continue-global": {
    id: "continue-global",
    label: "Continue (global)",
    scope: "global",
    format: "continue-config",
    path: (_root, home) => join(home, ".continue", "config.yaml"),
    entry: continueEntry,
  },
};

export const AGENT_IDS = Object.keys(AGENTS);

/** The default set wired without an explicit choice — project scope only. */
export const PROJECT_AGENT_IDS = ["claude-code", "cursor"];

/**
 * The interactive default: global scope — one wire covers every project
 * (the global stdio entry resolves the design folder from each cwd).
 */
export const GLOBAL_AGENT_IDS = ["claude-code-global", "cursor-global"];
