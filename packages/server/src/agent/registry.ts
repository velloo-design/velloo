import type { AgentAdapter } from "./adapter.ts";
import { ClaudeCodeAdapter } from "./claude/adapter.ts";
import { CodexAdapter } from "./codex/adapter.ts";

/** The CLI agents the Agent tab offers, in the order its picker lists them. */
export function defaultAgentAdapters(): AgentAdapter[] {
  return [new CodexAdapter(), new ClaudeCodeAdapter()];
}
