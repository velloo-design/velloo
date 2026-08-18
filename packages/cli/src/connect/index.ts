import { homedir } from "node:os";
import { AGENTS } from "./agents.ts";
import { type CursorRulesResult, installCursorRules } from "./cursor-rules.ts";
import { resolveProjectRoot } from "./project-root.ts";
import { installSkill, type SkillResult } from "./skill.ts";
import { type WriteResult, writeAgentConfig } from "./write-config.ts";

export { AGENT_IDS, AGENTS, PROJECT_AGENT_IDS } from "./agents.ts";
export type { WriteResult } from "./write-config.ts";

/** Default velloo MCP endpoint — matches `velloo run`'s default port. */
export const DEFAULT_MCP_URL = "http://127.0.0.1:7301/mcp";

export interface ConnectOptions {
  designFolder: string;
  /** Agent ids to wire (see AGENT_IDS). */
  agents: string[];
  /** Override the auto-detected config write location. */
  projectRoot?: string;
  mcpUrl?: string;
  /** Install the Claude Code skill (only acts when claude-code is targeted). */
  installSkill?: boolean;
  /** Home dir for global-scope agent configs. Defaults to os.homedir(); injectable for tests. */
  homeDir?: string;
}

export interface ConnectResult {
  projectRoot: string;
  mcpUrl: string;
  configs: WriteResult[];
  skill?: SkillResult;
  /** Cursor project rule, installed when cursor is a target. */
  cursorRules?: CursorRulesResult;
  /** Requested agent ids that aren't recognized. */
  unknownAgents: string[];
}

/** Wire the velloo MCP server into one or more AI coding agents' configs. */
export async function connect(opts: ConnectOptions): Promise<ConnectResult> {
  const mcpUrl = opts.mcpUrl ?? DEFAULT_MCP_URL;
  const homeDir = opts.homeDir ?? homedir();
  const projectRoot = await resolveProjectRoot(opts.designFolder, opts.projectRoot);

  const configs: WriteResult[] = [];
  const unknownAgents: string[] = [];
  for (const id of opts.agents) {
    const agent = AGENTS[id];
    if (!agent) {
      unknownAgents.push(id);
      continue;
    }
    configs.push(await writeAgentConfig(projectRoot, agent, mcpUrl, homeDir));
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

  return { projectRoot, mcpUrl, configs, skill, cursorRules, unknownAgents };
}
