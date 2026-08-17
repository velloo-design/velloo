import { AGENTS } from "./agents.ts";
import { resolveProjectRoot } from "./project-root.ts";
import { installSkill, type SkillResult } from "./skill.ts";
import { type WriteResult, writeAgentConfig } from "./write-config.ts";

export { AGENT_IDS, AGENTS } from "./agents.ts";
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
}

export interface ConnectResult {
  projectRoot: string;
  mcpUrl: string;
  configs: WriteResult[];
  skill?: SkillResult;
  /** Requested agent ids that aren't recognized. */
  unknownAgents: string[];
}

/** Wire the velloo MCP server into one or more AI coding agents' configs. */
export async function connect(opts: ConnectOptions): Promise<ConnectResult> {
  const mcpUrl = opts.mcpUrl ?? DEFAULT_MCP_URL;
  const projectRoot = await resolveProjectRoot(opts.designFolder, opts.projectRoot);

  const configs: WriteResult[] = [];
  const unknownAgents: string[] = [];
  for (const id of opts.agents) {
    const agent = AGENTS[id];
    if (!agent) {
      unknownAgents.push(id);
      continue;
    }
    configs.push(await writeAgentConfig(projectRoot, agent, mcpUrl));
  }

  // The skill is Claude Code-specific — only install it when that agent
  // is in the target set.
  const skill =
    opts.installSkill && opts.agents.includes("claude-code")
      ? await installSkill(projectRoot)
      : undefined;

  return { projectRoot, mcpUrl, configs, skill, unknownAgents };
}
