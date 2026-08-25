import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { relative } from "node:path";
import { isCancel, multiselect } from "@clack/prompts";
import { AGENTS, type AgentConfigFormat, GLOBAL_AGENT_IDS, type McpConnection } from "./agents.ts";
import { type CursorRulesResult, installCursorRules } from "./cursor-rules.ts";
import { resolveProjectRoot } from "./project-root.ts";
import { installSkills, type SkillResult } from "./skill.ts";
import { type WriteResult, writeAgentConfig } from "./write-config.ts";

export { AGENT_IDS, AGENTS, GLOBAL_AGENT_IDS, PROJECT_AGENT_IDS } from "./agents.ts";
export type { WriteResult } from "./write-config.ts";

/** Default velloo MCP endpoint for `--http` connections — matches `velloo mcp --http`. */
export const DEFAULT_MCP_URL = "http://127.0.0.1:7301/mcp";

/**
 * Sentinel id `pickAgents` returns for the "manual / other agent" choice —
 * not a real AgentTarget; callers filter it out and print `manualSetupText`.
 */
export const MANUAL_AGENT_ID = "manual";

/**
 * The copy-paste MCP config for agents velloo can't wire itself. Kept in one
 * place so `velloo connect` and the init wizard print the same thing.
 */
export function manualSetupText(): string {
  return [
    "velloo speaks MCP over stdio (recommended) or HTTP — any MCP-capable agent can connect.",
    "",
    "stdio — the agent spawns the server itself:",
    '  command: "velloo"   args: ["mcp"]',
    '  (resolves the design folder from the agent\'s cwd; pin one with ["mcp", "path/to/velloo"])',
    "",
    "  Most agents take the JSON convention:",
    '    { "mcpServers": { "velloo": { "command": "velloo", "args": ["mcp"] } } }',
    "",
    "HTTP — for agents that dial a URL: start `velloo mcp --http <folder>` (it prints the",
    `MCP URL, default ${DEFAULT_MCP_URL}), then point the agent at it:`,
    `    { "mcpServers": { "velloo": { "type": "http", "url": "${DEFAULT_MCP_URL}" } } }`,
  ].join("\n");
}

/**
 * Interactive agent checklist (global scope first + preselected — one wire
 * covers every project), plus a "manual / other agent" row that resolves to
 * MANUAL_AGENT_ID. Shared by `velloo connect` and the init wizard. `exclude`
 * hides agents that are already wired; `initial` overrides the preselection
 * (defaults to the global pair). Returns the chosen ids, or null on cancel.
 */
export async function pickAgents(opts?: {
  exclude?: string[];
  initial?: string[];
}): Promise<string[] | null> {
  const exclude = new Set(opts?.exclude ?? []);
  const agents = Object.values(AGENTS)
    .filter((a) => !exclude.has(a.id))
    .sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "global" ? -1 : 1));
  const initial = (opts?.initial ?? GLOBAL_AGENT_IDS).filter((id) => !exclude.has(id));
  const picked = await multiselect<string>({
    message: "Wire the velloo MCP into which agents?",
    options: [
      ...agents.map((a) => ({
        value: a.id,
        label: a.label,
        hint: a.path(".", "~"),
      })),
      {
        value: MANUAL_AGENT_ID,
        label: "Manual / other agent",
        hint: "prints the MCP config to paste anywhere",
      },
    ],
    initialValues: initial,
    required: false,
  });
  return isCancel(picked) ? null : picked;
}

/** Whether an agent config's content already carries a velloo MCP entry. */
function hasVellooEntry(content: string, format: AgentConfigFormat): boolean {
  try {
    switch (format) {
      case "json": {
        const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
        return Boolean(parsed.mcpServers && "velloo" in parsed.mcpServers);
      }
      case "codex-toml":
        return /^\s*\[\s*mcp_servers\s*\.\s*(?:"velloo"|velloo)\s*(?:\]|\.)/m.test(content);
      case "continue-block":
        return true; // the block file IS velloo's own entry
      case "continue-config": {
        const doc = Bun.YAML.parse(content) as { mcpServers?: unknown };
        return (
          Array.isArray(doc?.mcpServers) &&
          doc.mcpServers.some(
            (s) =>
              s !== null && typeof s === "object" && (s as { name?: unknown }).name === "velloo",
          )
        );
      }
    }
  } catch {
    return false;
  }
}

/**
 * Global agents whose config already carries a velloo entry — a global stdio
 * wire resolves the design folder from each project's cwd, so an existing
 * entry means this project is already covered and init can skip the wiring
 * question.
 */
export async function globallyWiredAgents(homeDir = homedir()): Promise<string[]> {
  const out: string[] = [];
  for (const agent of Object.values(AGENTS)) {
    if (agent.scope !== "global") continue;
    let content: string;
    try {
      content = await readFile(agent.path(".", homeDir), "utf8");
    } catch {
      continue;
    }
    if (hasVellooEntry(content, agent.format)) out.push(agent.id);
  }
  return out;
}

export interface ConnectOptions {
  designFolder: string;
  /** Agent ids to wire (see AGENT_IDS). */
  agents: string[];
  /** Override the auto-detected config write location. */
  projectRoot?: string;
  /** MCP transport to wire. Default "stdio" — the agent spawns `velloo mcp`. */
  transport?: "stdio" | "http";
  /** HTTP endpoint, only used when transport is "http". Default DEFAULT_MCP_URL. */
  mcpUrl?: string;
  /** Install the Claude Code skill (only acts when claude-code is targeted). */
  installSkill?: boolean;
  /** Home dir for global-scope agent configs. Defaults to os.homedir(); injectable for tests. */
  homeDir?: string;
}

export interface ConnectResult {
  projectRoot: string;
  transport: "stdio" | "http";
  configs: WriteResult[];
  skills?: SkillResult[];
  /** Cursor project rule, installed when cursor is a target. */
  cursorRules?: CursorRulesResult;
  /** Requested agent ids that aren't recognized. */
  unknownAgents: string[];
}

/** Wire the velloo MCP server into one or more AI coding agents' configs. */
export async function connect(opts: ConnectOptions): Promise<ConnectResult> {
  const transport = opts.transport ?? "stdio";
  const homeDir = opts.homeDir ?? homedir();
  const projectRoot = await resolveProjectRoot(opts.designFolder, opts.projectRoot);

  // stdio: project-scoped configs pin the folder relative to the project root
  // (the cwd the agent spawns `velloo mcp` from); global configs omit it so a
  // single entry resolves the folder per-project from the cwd.
  const designRel = relative(projectRoot, opts.designFolder) || ".";
  const connectionFor = (scope: "project" | "global"): McpConnection => {
    if (transport === "http") return { transport: "http", url: opts.mcpUrl ?? DEFAULT_MCP_URL };
    return {
      transport: "stdio",
      command: "velloo",
      args: scope === "project" ? ["mcp", designRel] : ["mcp"],
    };
  };

  const configs: WriteResult[] = [];
  const unknownAgents: string[] = [];
  for (const id of opts.agents) {
    const agent = AGENTS[id];
    if (!agent) {
      unknownAgents.push(id);
      continue;
    }
    configs.push(await writeAgentConfig(projectRoot, agent, connectionFor(agent.scope), homeDir));
  }

  // Per-agent guidance: the Claude skill for the claude-code family, a project
  // rule for the cursor family. Both are gated on installSkill (the "wire
  // guidance too" flag) and keyed on family so global targets count too.
  const hasFamily = (family: "claude-code" | "cursor") =>
    opts.agents.some((id) => AGENTS[id]?.family === family);
  const skills =
    opts.installSkill && hasFamily("claude-code") ? await installSkills(projectRoot) : undefined;
  const cursorRules =
    opts.installSkill && hasFamily("cursor")
      ? await installCursorRules(projectRoot, opts.designFolder)
      : undefined;

  return { projectRoot, transport, configs, skills, cursorRules, unknownAgents };
}
