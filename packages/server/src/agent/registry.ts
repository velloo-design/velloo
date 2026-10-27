import { ACP_AGENTS, AcpAdapter } from "./acp/adapter.ts";
import type { AgentAdapter } from "./adapter.ts";
import { ClaudeCodeAdapter } from "./claude/adapter.ts";
import { CodexAdapter } from "./codex/adapter.ts";

/** The CLI agents the Agent tab offers, in the order its picker lists them. */
export function defaultAgentAdapters(): AgentAdapter[] {
  return [
    new CodexAdapter(),
    new ClaudeCodeAdapter(),
    ...ACP_AGENTS.map((spec) => new AcpAdapter(spec)),
  ];
}
