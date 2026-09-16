import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { localDesignOf } from "@velloo/server";
import { AGENTS, type AgentConfigFormat } from "./agents.ts";
import { designArgumentFor } from "./project-root.ts";
import { writeAgentConfig } from "./write-config.ts";

interface StdioEntry {
  command: string;
  args: string[];
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function asEntry(value: unknown): StdioEntry | null {
  if (value === null || typeof value !== "object") return null;
  const { command, args } = value as { command?: unknown; args?: unknown };
  return typeof command === "string" && isStrings(args) ? { command, args } : null;
}

/** Velloo's stdio entry in a project-scoped agent config, whatever its format. */
function readStdioEntry(content: string, format: AgentConfigFormat): StdioEntry | null {
  try {
    switch (format) {
      case "json":
        return asEntry(
          (JSON.parse(content) as { mcpServers?: { velloo?: unknown } }).mcpServers?.velloo,
        );
      case "vscode-json":
        return asEntry((JSON.parse(content) as { servers?: { velloo?: unknown } }).servers?.velloo);
      case "opencode-json": {
        const entry = (JSON.parse(content) as { mcp?: { velloo?: { command?: unknown } } }).mcp
          ?.velloo;
        const command = entry?.command;
        return isStrings(command) && command[0]
          ? { command: command[0], args: command.slice(1) }
          : null;
      }
      case "codex-toml":
        return asEntry(
          (Bun.TOML.parse(content) as { mcp_servers?: { velloo?: unknown } }).mcp_servers?.velloo,
        );
      case "continue-block":
        return asEntry((Bun.YAML.parse(content) as { mcpServers?: unknown[] }).mcpServers?.[0]);
      case "continue-config":
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Rewrite project agent configs that pin a design by one of its names.
 *
 * Velloo 0.1.0 wired `velloo mcp <name>`. A listed design is now found from the
 * agent's directory instead, and a pinned name stops the agent's MCP server
 * from starting the moment the design is renamed. Each config pinned to one of
 * `names` gets the arguments `velloo connect` would write today: bare `mcp`
 * for a design the project's velloo.json lists, else its folder path. Configs
 * that pin anything else, or carry no velloo entry, are left alone. Returns the
 * files rewritten.
 */
export async function repinAgentConfigs(opts: {
  projectRoots: string[];
  designFolder: string;
  names: readonly string[];
  homeDir?: string;
}): Promise<string[]> {
  if (localDesignOf(opts.designFolder)) return [];
  const homeDir = opts.homeDir ?? homedir();
  const names = new Set(opts.names);
  const rewritten: string[] = [];
  for (const projectRoot of opts.projectRoots) {
    const designArg = await designArgumentFor(projectRoot, opts.designFolder);
    const desired = designArg ? ["mcp", designArg] : ["mcp"];
    for (const agent of Object.values(AGENTS)) {
      if (agent.scope !== "project" || agent.gui) continue;
      const path = agent.path(projectRoot, homeDir);
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch {
        continue;
      }
      const entry = readStdioEntry(content, agent.format);
      const pinned =
        entry?.args.length === 2 && entry.args[0] === "mcp" ? entry.args[1] : undefined;
      if (!entry || pinned === undefined || !names.has(pinned) || pinned === desired[1]) continue;
      await writeAgentConfig(
        projectRoot,
        agent,
        { transport: "stdio", command: entry.command, args: desired },
        homeDir,
      );
      rewritten.push(path);
    }
  }
  return rewritten;
}
