import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isCancel, log, multiselect, select } from "@clack/prompts";
import { localDesignOf } from "@velloo/server";
import pc from "picocolors";
import {
  AGENTS,
  type AgentConfigFormat,
  type AgentTarget,
  detectInstalledAgents,
  GLOBAL_AGENT_IDS,
  type McpConnection,
} from "./agents.ts";
import { type CursorRulesResult, installCursorRules } from "./cursor-rules.ts";
import {
  type ClaudePluginResult,
  type GeminiExtensionResult,
  installClaudePlugin,
  installGeminiExtension,
} from "./plugin.ts";
import { designArgumentFor, resolveProjectRoot } from "./project-root.ts";
import { installSkills, type SkillResult } from "./skill.ts";
import { type WriteResult, writeAgentConfig } from "./write-config.ts";

export { AGENT_IDS, GLOBAL_AGENT_IDS, PROJECT_AGENT_IDS } from "./agents.ts";
export { refreshAgentArtifacts } from "./refresh.ts";

/** Default velloo MCP endpoint for `--http` connections — matches `velloo mcp --http`. */
export const DEFAULT_MCP_URL = "http://127.0.0.1:7301/mcp";

/**
 * Sentinel id `pickAgents` returns for the "manual / other agent" choice —
 * not a real AgentTarget; callers filter it out and print `manualSetupText`.
 */
export const MANUAL_AGENT_ID = "manual";

/**
 * The copy-paste MCP config for agents velloo can't wire itself. Kept in one
 * place so `velloo connect` and the init wizard print the same thing.
 */
export function manualSetupText(): string {
  return [
    "velloo speaks MCP over stdio (recommended) or HTTP — any MCP-capable agent can connect.",
    "",
    "stdio — the agent spawns the server itself:",
    '  command: "velloo"   args: ["mcp"]',
    '  (resolves the design folder from the agent\'s cwd; pin one with ["mcp", "path/to/velloo"])',
    "",
    "  Most agents take the JSON convention:",
    '    { "mcpServers": { "velloo": { "command": "velloo", "args": ["mcp"] } } }',
    "",
    "HTTP — for agents that dial a URL: start `velloo mcp --http <folder>` (it prints the",
    `MCP URL, default ${DEFAULT_MCP_URL}), then point the agent at it:`,
    `    { "mcpServers": { "velloo": { "type": "http", "url": "${DEFAULT_MCP_URL}" } } }`,
  ].join("\n");
}

/** The agent's display name without the "(project)" / "(global)" scope suffix. */
function baseLabel(id: string): string {
  return (AGENTS[id]?.label ?? id).replace(/\s*\((?:project|global)\)$/, "");
}

/** The project-scoped counterpart of an agent id, when one exists. */
function projectVariantOf(id: string): string | undefined {
  const agent = AGENTS[id];
  if (!agent) return undefined;
  if (agent.scope === "project") return id;
  const candidate = id.replace(/-global$/, "");
  return candidate !== id && AGENTS[candidate] ? candidate : undefined;
}

/**
 * The interactive wiring choices, collected up front and applied later (init
 * writes agent configs only after the scaffold lands, so cancelling the
 * wizard never leaves files behind).
 */
export interface AgentWiring {
  /** Agent ids to wire (may be empty). */
  agents: string[];
  /** Print the manual MCP setup text at apply time. */
  manual: boolean;
  /** Global agent ids that already carried velloo before this run. */
  preWired: string[];
}

/**
 * The agent-wiring question, split in two: first show which coding agents are
 * installed on this machine, then ask how to wire them — globally on the
 * detected agents (one config covers every project), per project, hand-picked
 * from the full list, manual instructions, or not at all. Shared by
 * `velloo connect` and the init wizard. Returns null on cancel.
 */
export async function askAgentWiring(opts?: {
  /**
   * Skip the question entirely when every detected agent already carries a
   * global velloo entry (init re-runs shouldn't nag); `velloo connect` keeps
   * asking so an explicit invocation can always add more.
   */
  skipWhenCovered?: boolean;
  /**
   * Repo root to check for *project*-scoped wiring. Passing it makes the
   * checklist arrive ticked for what this project already has, which is the
   * common case when adding a second design folder to a wired repo.
   */
  projectRoot?: string;
  /** Offer global configs only — a local design writes nothing into its checkout. */
  globalOnly?: boolean;
}): Promise<AgentWiring | null> {
  const preWired = await globallyWiredAgents();
  const projectWired =
    opts?.projectRoot && !opts.globalOnly ? await projectWiredAgents(opts.projectRoot) : [];
  const detected = detectInstalledAgents();
  const fallback = detected.length === 0;
  const wanted = fallback ? GLOBAL_AGENT_IDS : detected;
  const missing = wanted.filter((id) => !preWired.includes(id));

  if (projectWired.length > 0) {
    log.info(
      `Already wired for this project: ${projectWired.map(baseLabel).join(", ")} ${pc.dim("(re-wiring is a no-op merge)")}`,
    );
  }
  if (preWired.length > 0) {
    const labels = preWired.map(baseLabel).join(", ");
    if (opts?.skipWhenCovered && missing.length === 0) {
      log.success(
        `velloo is already wired globally — ${labels} ${pc.dim("(covers this project; skipping agent setup)")}`,
      );
      return { agents: [], manual: false, preWired };
    }
    log.info(`Already wired globally: ${labels} ${pc.dim("(covers this project)")}`);
  }

  log.info(
    fallback
      ? `No coding agents detected on this machine — offering the defaults (${wanted.map(baseLabel).join(", ")}).`
      : `Coding agents detected: ${detected.map(baseLabel).join(", ")}`,
  );

  // Re-offering an already-wired agent is an idempotent config merge, so when
  // everything is covered (`velloo connect` re-run) the full set stays on offer.
  const targets = missing.length > 0 ? missing : wanted;
  const names = targets.map(baseLabel).join(", ");
  const projectTargets = opts?.globalOnly
    ? []
    : targets.map(projectVariantOf).filter((id): id is string => Boolean(id));
  if (opts?.globalOnly)
    log.info(
      pc.dim(
        "This design lives outside the repository, so only global agent configs are offered — nothing is written into the checkout.",
      ),
    );

  const mode = await select<"global" | "project" | "choose" | "manual" | "skip">({
    message: "Wire the velloo MCP into your coding agents?",
    options: [
      {
        value: "global",
        label: `Install globally — ${names}`,
        hint: "recommended — one config covers every project",
      },
      ...(projectTargets.length > 0
        ? [
            {
              value: "project" as const,
              label: "Install for this project only",
              hint: projectTargets.map(baseLabel).join(", "),
            },
          ]
        : []),
      { value: "choose", label: "Let me pick agents", hint: "the full list" },
      {
        value: "manual",
        label: "Manual MCP setup instructions",
        hint: "prints the config to paste into any agent",
      },
      { value: "skip", label: "Don't install now", hint: "wire later with `velloo connect`" },
    ],
    initialValue: "global",
  });
  if (isCancel(mode)) return null;

  if (mode === "skip") return { agents: [], manual: false, preWired };
  if (mode === "manual") return { agents: [], manual: true, preWired };
  if (mode === "global") return { agents: targets, manual: false, preWired };
  if (mode === "project") return { agents: projectTargets, manual: false, preWired };

  const picked = await pickAgents({
    exclude: [
      ...(opts?.skipWhenCovered ? preWired : []),
      ...(opts?.globalOnly
        ? Object.values(AGENTS)
            .filter((agent) => agent.scope === "project")
            .map((agent) => agent.id)
        : []),
    ],
    // Tick what this machine and this repo already carry, on top of what's
    // installed — re-selecting a wired agent is an idempotent merge, so the
    // safe default is "everything that's already true stays true".
    initial: [...new Set([...targets, ...preWired, ...projectWired])],
    wired: [...new Set([...preWired, ...projectWired])],
  });
  if (picked === null) return null;
  return {
    agents: picked.filter((id) => id !== MANUAL_AGENT_ID),
    manual: picked.includes(MANUAL_AGENT_ID),
    preWired,
  };
}

/**
 * The "let me pick" checklist behind `askAgentWiring` (global scope first —
 * one wire covers every project), plus a "manual / other agent" row that
 * resolves to MANUAL_AGENT_ID. `exclude` hides agents that are already wired;
 * `initial` overrides the preselection — by default the agents detected on
 * this machine (falling back to the global claude+cursor pair when none
 * are). Returns the chosen ids, or null on cancel.
 */
async function pickAgents(opts?: {
  exclude?: string[];
  initial?: string[];
  /** Agents already carrying a velloo entry — shown as such in the list. */
  wired?: string[];
}): Promise<string[] | null> {
  const exclude = new Set(opts?.exclude ?? []);
  const wired = new Set(opts?.wired ?? []);
  const agents = Object.values(AGENTS)
    .filter((a) => !exclude.has(a.id))
    .sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "global" ? -1 : 1));
  const detected = detectInstalledAgents();
  const initial = (opts?.initial ?? (detected.length > 0 ? detected : GLOBAL_AGENT_IDS)).filter(
    (id) => !exclude.has(id),
  );
  const picked = await multiselect<string>({
    message: "Wire the velloo MCP into which agents?",
    options: [
      ...agents.map((a) => ({
        value: a.id,
        label: a.label,
        hint: wired.has(a.id) ? `already wired — ${a.path(".", "~")}` : a.path(".", "~"),
      })),
      {
        value: MANUAL_AGENT_ID,
        label: "Manual / other agent",
        hint: "prints the MCP config to paste anywhere",
      },
    ],
    initialValues: initial,
    required: false,
  });
  return isCancel(picked) ? null : picked;
}

/** Whether an agent config's content already carries a velloo MCP entry. */
function hasVellooEntry(content: string, format: AgentConfigFormat): boolean {
  try {
    switch (format) {
      case "json": {
        const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
        return Boolean(parsed.mcpServers && "velloo" in parsed.mcpServers);
      }
      case "codex-toml":
        return /^\s*\[\s*mcp_servers\s*\.\s*(?:"velloo"|velloo)\s*(?:\]|\.)/m.test(content);
      case "continue-block":
        return true; // the block file IS velloo's own entry
      case "continue-config": {
        const doc = Bun.YAML.parse(content) as { mcpServers?: unknown };
        return (
          Array.isArray(doc?.mcpServers) &&
          doc.mcpServers.some(
            (s) =>
              s !== null && typeof s === "object" && (s as { name?: unknown }).name === "velloo",
          )
        );
      }
      case "opencode-json": {
        const parsed = JSON.parse(content) as { mcp?: Record<string, unknown> };
        return Boolean(parsed.mcp && "velloo" in parsed.mcp);
      }
      case "vscode-json": {
        const parsed = JSON.parse(content) as { servers?: Record<string, unknown> };
        return Boolean(parsed.servers && "velloo" in parsed.servers);
      }
    }
  } catch {
    return false;
  }
}

/**
 * Global agents whose config already carries a velloo entry — a global stdio
 * wire resolves the design folder from each project's cwd, so an existing
 * entry means this project is already covered and init can skip the wiring
 * question.
 */
/**
 * Agents whose *project*-scoped config in `projectRoot` already carries a
 * velloo entry. The global twin below answers the same question one level up;
 * the wiring prompt needs both, because "already installed" is what the
 * checklist should arrive pre-ticked with.
 */
async function projectWiredAgents(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const agent of Object.values(AGENTS)) {
    if (agent.scope !== "project") continue;
    let content: string;
    try {
      content = await readFile(agent.path(projectRoot, homedir()), "utf8");
    } catch {
      continue;
    }
    if (hasVellooEntry(content, agent.format)) out.push(agent.id);
  }
  return out;
}

export async function globallyWiredAgents(homeDir = homedir()): Promise<string[]> {
  const out: string[] = [];
  for (const agent of Object.values(AGENTS)) {
    if (agent.scope !== "global") continue;
    let content: string;
    try {
      content = await readFile(agent.path(".", homeDir), "utf8");
    } catch {
      continue;
    }
    if (hasVellooEntry(content, agent.format)) out.push(agent.id);
  }
  return out;
}

export interface ConnectOptions {
  designFolder: string;
  /** Agent ids to wire (see AGENT_IDS). */
  agents: string[];
  /** Override the auto-detected config write location. */
  projectRoot?: string | undefined;
  /** MCP transport to wire. Default "stdio" — the agent spawns `velloo mcp`. */
  transport?: "stdio" | "http" | undefined;
  /** HTTP endpoint, only used when transport is "http". Default DEFAULT_MCP_URL. */
  mcpUrl?: string | undefined;
  /** Install the Claude Code skill (only acts when claude-code is targeted). */
  installSkill?: boolean | undefined;
  /** Home dir for global-scope agent configs. Defaults to os.homedir(); injectable for tests. */
  homeDir?: string | undefined;
}

export interface ConnectResult {
  projectRoot: string;
  transport: "stdio" | "http";
  configs: WriteResult[];
  /** Neutral `.agents/skills/` copies, installed for the SKILL.md ecosystem. */
  skills?: SkillResult[] | undefined;
  /** The velloo Claude Code plugin (local-path marketplace), for claude targets. */
  plugin?: ClaudePluginResult | undefined;
  /** The velloo Gemini CLI extension, materialized when gemini is a target. */
  geminiExtension?: GeminiExtensionResult | undefined;
  /** Cursor project rule, installed when cursor is a target. */
  cursorRules?: CursorRulesResult | undefined;
  /** Requested agent ids that aren't recognized. */
  unknownAgents: string[];
  /** Project-scoped agent ids refused because the design is local. */
  projectScoped: string[];
}

/** Project-scoped agents a local design cannot use, with the global ids to use instead. */
export function localDesignScopeProblem(folder: string, agents: string[]): string | null {
  if (!localDesignOf(folder)) return null;
  const refused = agents.filter((id) => AGENTS[id]?.scope === "project");
  if (refused.length === 0) return null;
  const globals = refused
    .map((id) => `${id}-global`)
    .filter((id) => AGENTS[id])
    .join(", ");
  return `${refused.join(", ")} ${refused.length === 1 ? "writes" : "write"} into the checkout, and ${folder} is a local design outside it — only global configs are allowed${globals ? ` (use ${globals})` : ""}.`;
}

/** Wire the velloo MCP server into one or more AI coding agents' configs. */
export async function connect(opts: ConnectOptions): Promise<ConnectResult> {
  const transport = opts.transport ?? "stdio";
  const homeDir = opts.homeDir ?? homedir();
  const projectRoot = await resolveProjectRoot(opts.designFolder, opts.projectRoot);
  // A local design leaves no trace in its checkout: no project configs, and
  // no guidance files (skills, Cursor rule) that only project scope reads.
  const local = localDesignOf(opts.designFolder) !== null;

  // stdio: configs name no design when the checkout lists it — `velloo mcp`
  // resolves it from the cwd the agent spawns it in, and the session can
  // switch designs, so a pinned name would only go stale on a rename. An
  // unlisted folder is pinned by its path from the project root. GUI apps
  // (Claude Desktop) get neither the user's shell PATH nor a meaningful cwd:
  // `velloo`'s `#!/usr/bin/env bun` shebang would fail to find bun, and a
  // cwd-resolved folder would resolve nowhere — so wire the absolute bun +
  // cli script and pin the design folder absolutely.
  const designArg = await designArgumentFor(projectRoot, opts.designFolder);
  const connectionFor = (agent: AgentTarget): McpConnection => {
    if (transport === "http") return { transport: "http", url: opts.mcpUrl ?? DEFAULT_MCP_URL };
    if (agent.gui) {
      const script = process.argv[1] ? resolve(process.argv[1]) : Bun.which("velloo");
      return script
        ? {
            transport: "stdio",
            command: process.execPath,
            args: [script, "mcp", resolve(opts.designFolder)],
          }
        : { transport: "stdio", command: "velloo", args: ["mcp", resolve(opts.designFolder)] };
    }
    return {
      transport: "stdio",
      command: "velloo",
      args: agent.scope === "project" && designArg ? ["mcp", designArg] : ["mcp"],
    };
  };

  const configs: WriteResult[] = [];
  const unknownAgents: string[] = [];
  const projectScoped: string[] = [];
  for (const id of opts.agents) {
    const agent = AGENTS[id];
    if (!agent) {
      unknownAgents.push(id);
      continue;
    }
    if (local && agent.scope === "project") {
      projectScoped.push(id);
      continue;
    }
    configs.push(await writeAgentConfig(projectRoot, agent, connectionFor(agent), homeDir));
  }

  // Per-agent guidance, gated on installSkill (the "wire guidance too" flag)
  // and keyed on family/id so global targets count too:
  //   - claude-code family → the velloo PLUGIN (skills + commands + subagents
  //     via a local-path marketplace; one install covers every project).
  //   - the SKILL.md ecosystem (opencode, droid, cline, gemini, codex) →
  //     project `.agents/skills/` copies, the neutral location.
  //   - cursor family → a project rule.
  //   - gemini → additionally the Gemini CLI extension (context + commands).
  const hasFamily = (family: "claude-code" | "cursor") =>
    opts.agents.some((id) => AGENTS[id]?.family === family);
  const hasAny = (...ids: string[]) => opts.agents.some((id) => ids.includes(id));
  const plugin =
    opts.installSkill && hasFamily("claude-code")
      ? ((await installClaudePlugin(homeDir)) ?? undefined)
      : undefined;
  const skills =
    opts.installSkill &&
    !local &&
    hasAny(
      "opencode",
      "opencode-global",
      "droid-global",
      "cline-global",
      "gemini",
      "gemini-global",
      "codex",
      "codex-global",
    )
      ? await installSkills(projectRoot)
      : undefined;
  const geminiExtension =
    opts.installSkill && hasAny("gemini", "gemini-global")
      ? ((await installGeminiExtension(homeDir)) ?? undefined)
      : undefined;
  const cursorRules =
    opts.installSkill && !local && hasFamily("cursor")
      ? await installCursorRules(projectRoot, opts.designFolder)
      : undefined;

  return {
    projectRoot,
    transport,
    configs,
    skills,
    plugin,
    geminiExtension,
    cursorRules,
    unknownAgents,
    projectScoped,
  };
}
