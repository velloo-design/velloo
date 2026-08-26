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
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * How velloo connects: `stdio` (the agent spawns `velloo mcp` itself — the
 * default) or `http` (the agent dials a running server's URL).
 */
export type McpConnection =
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http"; url: string };

/** How the agent's config file is written — see write-config.ts for each merge. */
export type AgentConfigFormat =
  | "json"
  | "codex-toml"
  | "continue-block"
  | "continue-config"
  | "opencode-json"
  | "vscode-json";

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
  /**
   * GUI app (Claude Desktop): it spawns MCP servers without the user's shell
   * PATH and from an unrelated cwd, so the wire must use an absolute command
   * and pin the design folder absolutely (see connect()).
   */
  gui?: boolean;
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
// Droid spells the transport explicitly (matches what `droid mcp add` writes).
const droidEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http"
    ? { type: "http", url: conn.url }
    : { type: "stdio", command: conn.command, args: conn.args, disabled: false };
// Gemini CLI settings.json: stdio is command/args; streamable HTTP is `httpUrl`.
const geminiEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http" ? { httpUrl: conn.url } : { command: conn.command, args: conn.args };
// opencode: one `mcp` map, command as a single argv array (per its config schema).
const opencodeEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http"
    ? { type: "remote", url: conn.url, enabled: true }
    : { type: "local", command: [conn.command, ...conn.args], enabled: true };
// VS Code .vscode/mcp.json (Copilot agent mode): `servers` map with explicit type.
const vscodeEntry = (conn: McpConnection): Record<string, unknown> =>
  conn.transport === "http"
    ? { type: "http", url: conn.url }
    : { type: "stdio", command: conn.command, args: conn.args };

/** Claude Desktop's config lives under the OS app-config dir, not a dotfile. */
export function claudeDesktopConfigPath(homeDir: string): string {
  if (process.platform === "win32") {
    return join(homeDir, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "darwin") {
    return join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return join(homeDir, ".config", "Claude", "claude_desktop_config.json");
}

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
  "claude-desktop": {
    id: "claude-desktop",
    label: "Claude Desktop",
    scope: "global",
    format: "json",
    gui: true,
    path: (_root, home) => claudeDesktopConfigPath(home),
    entry: claudeEntry,
  },
  opencode: {
    id: "opencode",
    label: "opencode (project)",
    scope: "project",
    format: "opencode-json",
    path: (root) => join(root, "opencode.json"),
    entry: opencodeEntry,
  },
  "opencode-global": {
    id: "opencode-global",
    label: "opencode (global)",
    scope: "global",
    format: "opencode-json",
    path: (_root, home) => join(home, ".config", "opencode", "opencode.json"),
    entry: opencodeEntry,
  },
  "droid-global": {
    id: "droid-global",
    label: "Droid (global)",
    scope: "global",
    format: "json",
    path: (_root, home) => join(home, ".factory", "mcp.json"),
    entry: droidEntry,
  },
  "cline-global": {
    id: "cline-global",
    label: "Cline (global)",
    scope: "global",
    format: "json",
    path: (_root, home) => join(home, ".cline", "data", "settings", "cline_mcp_settings.json"),
    entry: cursorEntry,
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI (project)",
    scope: "project",
    format: "json",
    path: (root) => join(root, ".gemini", "settings.json"),
    entry: geminiEntry,
  },
  "gemini-global": {
    id: "gemini-global",
    label: "Gemini CLI (global)",
    scope: "global",
    format: "json",
    path: (_root, home) => join(home, ".gemini", "settings.json"),
    entry: geminiEntry,
  },
  "windsurf-global": {
    id: "windsurf-global",
    label: "Windsurf (global)",
    scope: "global",
    format: "json",
    path: (_root, home) => join(home, ".codeium", "windsurf", "mcp_config.json"),
    entry: cursorEntry,
  },
  vscode: {
    id: "vscode",
    label: "VS Code / Copilot (project)",
    scope: "project",
    format: "vscode-json",
    path: (root) => join(root, ".vscode", "mcp.json"),
    entry: vscodeEntry,
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

/**
 * Global agent ids that look installed on this machine — binary on PATH or
 * the agent's config dir in $HOME. Drives the wiring checklist preselection
 * (wire what the user actually has, not a fixed claude+cursor guess).
 */
export function detectInstalledAgents(homeDir = homedir()): string[] {
  const has = (rel: string) => existsSync(join(homeDir, rel));
  const found: string[] = [];
  if (Bun.which("claude") || has(".claude.json") || has(".claude")) {
    found.push("claude-code-global");
  }
  if (Bun.which("cursor-agent") || Bun.which("cursor") || has(".cursor")) {
    found.push("cursor-global");
  }
  if (Bun.which("codex") || has(".codex")) found.push("codex-global");
  if (has(".continue")) found.push("continue-global");
  if (existsSync(dirname(claudeDesktopConfigPath(homeDir)))) found.push("claude-desktop");
  if (Bun.which("opencode") || has(join(".config", "opencode"))) found.push("opencode-global");
  if (Bun.which("droid") || has(".factory")) found.push("droid-global");
  if (Bun.which("cline") || has(".cline")) found.push("cline-global");
  // ~/.gemini alone is not enough — Antigravity creates it without the CLI.
  if (Bun.which("gemini") || has(join(".gemini", "settings.json"))) found.push("gemini-global");
  if (has(join(".codeium", "windsurf"))) found.push("windsurf-global");
  return found;
}
