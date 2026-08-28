import { resolve } from "node:path";
import { defineCommand } from "citty";
import pc from "picocolors";
import {
  AGENT_IDS,
  askAgentWiring,
  connect,
  DEFAULT_MCP_URL,
  MANUAL_AGENT_ID,
  manualSetupText,
  PROJECT_AGENT_IDS,
} from "../connect/index.ts";
import { assertFolderFormatCurrent, DesignFolderFormatError } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";

export default defineCommand({
  meta: {
    name: "connect",
    description: "Wire the velloo MCP server into your AI coding agent's config",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
    },
    agent: {
      type: "string",
      description: `Comma-separated agents: ${AGENT_IDS.join(", ")}, manual — print the config for any other agent (default ${PROJECT_AGENT_IDS.join(",")})`,
    },
    projectRoot: {
      type: "string",
      description:
        "Where to write the config (default: nearest package.json above the design folder, else its parent)",
    },
    http: {
      type: "boolean",
      default: false,
      description: "Wire the HTTP transport (agent dials a running server) instead of stdio",
    },
    mcpUrl: {
      type: "string",
      description: `MCP server URL for --http (default ${DEFAULT_MCP_URL})`,
    },
    skill: {
      type: "boolean",
      default: true,
      description: "Install the velloo-design Claude Code skill into .claude/skills",
    },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "connect", { interactive: true });
    // Wiring an agent config is format-independent, so an out-of-date folder
    // only warns — but warn NOW, or the first thing the wired agent meets is
    // the MCP upgrade gate instead of the design tools.
    try {
      assertFolderFormatCurrent(folder);
    } catch (err) {
      if (!(err instanceof DesignFolderFormatError)) throw err;
      console.log(pc.yellow(`⚠ ${err.message.slice("velloo: ".length)}`));
    }
    const interactive = Boolean(process.stdin.isTTY);

    // Explicit --agent wins; otherwise ask interactively (init's wiring
    // question), falling back to the project defaults when there's no TTY.
    let agents: string[];
    let manual = false;
    if (args.agent) {
      agents = args.agent
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (interactive) {
      const wiring = await askAgentWiring();
      if (wiring === null) fail("connect", "cancelled.");
      if (wiring.agents.length === 0 && !wiring.manual) {
        console.log(pc.dim("No agents selected — nothing wired."));
        return;
      }
      manual = wiring.manual;
      agents = wiring.agents;
    } else {
      agents = PROJECT_AGENT_IDS;
    }
    // `--agent manual` also just prints the config — no files written.
    if (agents.includes(MANUAL_AGENT_ID)) {
      manual = true;
      agents = agents.filter((id) => id !== MANUAL_AGENT_ID);
    }

    if (manual) {
      console.log("");
      console.log(pc.bold("  Manual MCP setup"));
      for (const line of manualSetupText().split("\n")) console.log(`  ${line}`);
      console.log("");
    }
    if (agents.length === 0) return;

    const result = await connect({
      designFolder: folder,
      agents,
      projectRoot: args.projectRoot ? resolve(args.projectRoot) : undefined,
      transport: args.http ? "http" : "stdio",
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
    if (result.plugin) {
      console.log(
        `    plugin   ${pc.cyan("velloo@velloo")} ${pc.dim(`(skills + commands + subagents — local marketplace at ${result.plugin.marketplaceDir})`)}`,
      );
    }
    for (const s of result.skills ?? []) {
      console.log(`    skill    ${pc.cyan(s.path ?? s.name)}`);
    }
    if (result.geminiExtension) {
      console.log(
        `    gemini   ${pc.cyan(result.geminiExtension.dir)} ${
          result.geminiExtension.linked
            ? pc.dim("(linked)")
            : pc.dim(`(link it: gemini extensions link ${result.geminiExtension.dir})`)
        }`,
      );
    }
    if (result.cursorRules?.installed && result.cursorRules.path) {
      console.log(`    rule     ${pc.cyan(result.cursorRules.path)}`);
    }
    const folderArg = args.folder ? ` ${args.folder}` : "";
    console.log("");
    console.log(pc.bold("  Next"));
    if (result.transport === "http") {
      console.log(
        `    1. ${pc.cyan(`velloo mcp --http${folderArg}`)} ${pc.dim("— starts the MCP server your agent dials")}`,
      );
      console.log(`    2. Restart your agent so it loads the new MCP config.`);
    } else {
      console.log(
        `    1. Restart your agent so it loads the new MCP config ${pc.dim("— it starts velloo itself")}.`,
      );
      console.log(
        `    2. ${pc.cyan(`velloo run${folderArg}`)} ${pc.dim("— optional: open the canvas to watch")}`,
      );
    }
    console.log("");
  },
});
