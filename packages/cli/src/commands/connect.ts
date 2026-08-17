import { resolve } from "node:path";
import { defineCommand } from "citty";
import pc from "picocolors";
import { AGENT_IDS, connect, DEFAULT_MCP_URL } from "../connect/index.ts";
import { fail } from "../fail.ts";

export default defineCommand({
  meta: {
    name: "connect",
    description: "Wire the velloo MCP server into your AI coding agent's config",
  },
  args: {
    folder: { type: "positional", required: true, description: "Design folder" },
    agent: {
      type: "string",
      description: `Comma-separated agents: ${AGENT_IDS.join(", ")} (default claude-code)`,
    },
    projectRoot: {
      type: "string",
      description:
        "Where to write the config (default: nearest package.json above the design folder, else its parent)",
    },
    mcpUrl: {
      type: "string",
      description: `MCP server URL (default ${DEFAULT_MCP_URL})`,
    },
    skill: {
      type: "boolean",
      default: true,
      description: "Install the velloo-design Claude Code skill into .claude/skills",
    },
  },
  async run({ args }) {
    const agents = (args.agent ?? "claude-code")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await connect({
      designFolder: resolve(args.folder),
      agents,
      projectRoot: args.projectRoot ? resolve(args.projectRoot) : undefined,
      mcpUrl: args.mcpUrl,
      installSkill: args.skill,
    });

    if (result.unknownAgents.length > 0) {
      fail(
        "connect",
        `unknown agent(s): ${result.unknownAgents.join(", ")}. Valid: ${AGENT_IDS.join(", ")}.`,
      );
    }

    console.log("");
    console.log(pc.green("✓ Connected velloo to your agent."));
    console.log("");
    for (const c of result.configs) {
      console.log(`    ${c.action === "created" ? "wrote   " : "updated "} ${pc.cyan(c.path)}`);
    }
    if (result.skill?.installed && result.skill.path) {
      console.log(`    skill    ${pc.cyan(result.skill.path)}`);
    } else if (result.skill && !result.skill.installed) {
      console.log(pc.dim(`    skill skipped (${result.skill.reason})`));
    }
    console.log("");
    console.log(pc.bold("  Next"));
    console.log(
      `    1. ${pc.cyan(`velloo run ${args.folder}`)} ${pc.dim("— starts the MCP server velloo points at")}`,
    );
    console.log(`    2. Restart your agent so it loads the new MCP config.`);
    console.log("");
  },
});
