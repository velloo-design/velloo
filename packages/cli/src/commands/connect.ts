import { resolve } from "node:path";
import { defineCommand } from "citty";
import pc from "picocolors";
import {
  AGENT_IDS,
  connect,
  DEFAULT_MCP_URL,
  PROJECT_AGENT_IDS,
  pickAgents,
} from "../connect/index.ts";
import { fail } from "../fail.ts";
import { resolveDesignFolder } from "../folder.ts";

export default defineCommand({
  meta: {
    name: "connect",
    description: "Wire the velloo MCP server into your AI coding agent's config",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: "Design folder (default: ./velloo)",
    },
    agent: {
      type: "string",
      description: `Comma-separated agents: ${AGENT_IDS.join(", ")} (default ${PROJECT_AGENT_IDS.join(",")})`,
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
    const folder = await resolveDesignFolder(args.folder, "connect");
    const interactive = Boolean(process.stdin.isTTY);

    // Explicit --agent wins; otherwise ask interactively (init's checklist),
    // falling back to the project defaults when there's no TTY.
    let agents: string[];
    if (args.agent) {
      agents = args.agent
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (interactive) {
      const picked = await pickAgents();
      if (picked === null) fail("connect", "cancelled.");
      if (picked.length === 0) {
        console.log(pc.dim("No agents selected — nothing wired."));
        return;
      }
      agents = picked;
    } else {
      agents = PROJECT_AGENT_IDS;
    }

    const result = await connect({
      designFolder: folder,
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
    if (result.cursorRules?.installed && result.cursorRules.path) {
      console.log(`    rule     ${pc.cyan(result.cursorRules.path)}`);
    }
    console.log("");
    console.log(pc.bold("  Next"));
    console.log(
      `    1. ${pc.cyan(`velloo run${args.folder ? ` ${args.folder}` : ""}`)} ${pc.dim("— starts the MCP server velloo points at")}`,
    );
    console.log(`    2. Restart your agent so it loads the new MCP config.`);
    console.log("");
  },
});
