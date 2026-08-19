import { homedir } from "node:os";
import { relative } from "node:path";
import { isCancel, multiselect } from "@clack/prompts";
import { AGENTS, type McpConnection, PROJECT_AGENT_IDS } from "./agents.ts";
import { type CursorRulesResult, installCursorRules } from "./cursor-rules.ts";
import { resolveProjectRoot } from "./project-root.ts";
import { installSkill, type SkillResult } from "./skill.ts";
import { type WriteResult, writeAgentConfig } from "./write-config.ts";

export { AGENT_IDS, AGENTS, PROJECT_AGENT_IDS } from "./agents.ts";
export type { WriteResult } from "./write-config.ts";

/** Default velloo MCP endpoint for `--http` connections — matches `velloo mcp --http`. */
export const DEFAULT_MCP_URL = "http://127.0.0.1:7301/mcp";

/**
 * Interactive agent checklist (project scope preselected). Shared by `velloo
 * connect` and the init wizard. Returns the chosen ids, or null on cancel.
 */
export async function pickAgents(): Promise<string[] | null> {
  const picked = await multiselect<string>({
    message: "Wire the velloo MCP into which agents?",
    options: Object.values(AGENTS).map((a) => ({
      value: a.id,
      label: a.label,
      hint: a.path(".", "~"),
    })),
    initialValues: PROJECT_AGENT_IDS,
    required: false,
  });
  return isCancel(picked) ? null : picked;
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
  skill?: SkillResult;
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
  const skill =
    opts.installSkill && hasFamily("claude-code") ? await installSkill(projectRoot) : undefined;
  const cursorRules =
    opts.installSkill && hasFamily("cursor")
      ? await installCursorRules(projectRoot, opts.designFolder)
      : undefined;

  return { projectRoot, transport, configs, skill, cursorRules, unknownAgents };
}
