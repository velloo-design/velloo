import type { AgentAdapter } from "./adapter.ts";

/** The CLI agents the Agent tab offers, in the order its picker lists them. */
export function defaultAgentAdapters(): AgentAdapter[] {
  return [];
}
