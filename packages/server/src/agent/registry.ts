import { ACP_AGENTS, AcpAdapter } from "./acp/adapter.ts";
import type { AgentAdapter } from "./adapter.ts";
import { ClaudeCodeAdapter } from "./claude/adapter.ts";
import { CodexAdapter } from "./codex/adapter.ts";

/**
 * The CLI agents the Agent tab offers, in the order its picker lists them.
 * Claude Code leads, as it does on init's setup page: it is the agent most
 * people setting Velloo up have.
 */
export function defaultAgentAdapters(): AgentAdapter[] {
  return [
    new ClaudeCodeAdapter(),
    new CodexAdapter(),
    ...ACP_AGENTS.map((spec) => new AcpAdapter(spec)),
  ];
}
