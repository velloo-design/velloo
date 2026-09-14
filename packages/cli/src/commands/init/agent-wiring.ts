import pc from "picocolors";
import {
  type AgentWiring,
  type ConnectResult,
  connect,
  manualSetupText,
} from "../../connect/index.ts";

/**
 * How init's agent-wiring step ended: what was written this run, plus every
 * agent id known to carry velloo for this project (pre-existing global wires
 * included) — the launch offers downstream must only name wired agents.
 */
export interface WireOutcome {
  connected?: ConnectResult | undefined;
  wiredIds: string[];
}

export const NOT_WIRED: WireOutcome = { wiredIds: [] };

/**
 * Apply agent-wiring choices: write the MCP configs + guidance, print the
 * manual instructions if asked. The interactive *questions* live in the
 * wizard (`askAgentWiring`, asked before any file exists); this is the
 * write side, run only after the scaffold landed.
 */
export async function applyAgentWiring(folder: string, wiring: AgentWiring): Promise<WireOutcome> {
  let result: ConnectResult | undefined;
  if (wiring.agents.length > 0) {
    try {
      result = await connect({ designFolder: folder, agents: wiring.agents, installSkill: true });
    } catch {
      result = undefined;
    }
  }
  if (wiring.manual) {
    console.log("");
    console.log(pc.bold("  Manual MCP setup"));
    for (const line of manualSetupText().split("\n")) console.log(`  ${line}`);
  }
  return {
    connected: result,
    wiredIds: [...wiring.preWired, ...(result?.configs.map((c) => c.agent) ?? [])],
  };
}

export function printWired(outcome: WireOutcome): void {
  const connected = outcome.connected;
  if (!connected || connected.configs.length === 0) return;
  const wired = connected.configs.map((c) => c.agent).join(" + ");
  console.log("");
  console.log(pc.bold("  Agents wired"));
  console.log(
    `    ${pc.green("✓")} ${wired} ${pc.dim(`(MCP config under ${connected.projectRoot})`)}`,
  );
  if (connected.plugin)
    console.log(pc.dim("    + Claude Code plugin (skills · commands · subagents)"));
  if (connected.skills?.length)
    console.log(
      pc.dim(
        `    + ${connected.skills.length} agent skill${connected.skills.length === 1 ? "" : "s"} (.agents/skills)`,
      ),
    );
  if (connected.geminiExtension)
    console.log(
      pc.dim(
        `    + Gemini extension${connected.geminiExtension.linked ? "" : ` (link it: gemini extensions link ${connected.geminiExtension.dir})`}`,
      ),
    );
  if (connected.cursorRules?.installed) console.log(pc.dim("    + Cursor rule"));
}
