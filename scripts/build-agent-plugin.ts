#!/usr/bin/env bun
/**
 * Assemble the public agent plugin: one folder that installs into Claude Code,
 * Codex, Cursor, GitHub Copilot, Gemini CLI, Antigravity and the agents that
 * read their formats (Factory Droid, Devin, Kiro), published by the release
 * workflow to velloo-design/velloo-plugin.
 *
 *   bun scripts/build-agent-plugin.ts --version 0.11.0 [--out <dir>]
 *
 * The skills, slash commands and subagents come from the same sources
 * `velloo connect` installs (skills/, plugins/claude/velloo, plugins/gemini).
 * What differs is the MCP server: connect wires `velloo mcp` into each agent's
 * own config, while an installed plugin has to bring it along, so every
 * manifest here starts it through npx, pinned to this release. Each format
 * reads only its own files, so they share one root: the Agent Plugins
 * `plugin.json` + `mcp.json` (Codex, Copilot, Cursor, Kiro), `.claude-plugin/`
 * + `.mcp.json`, `.cursor-plugin/`, `.antigravity-plugin/` + `mcp_config.json`,
 * and `gemini-extension.json`, which Gemini's gallery requires at a repo root.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const repoRoot = resolve(import.meta.dir, "..");

const PLUGIN_REPO = "velloo-design/velloo-plugin";
/** The Claude/Codex marketplace name — distinct from the `velloo` marketplace connect builds locally. */
export const MARKETPLACE = "velloo-plugin";

const DESCRIPTION =
  "Design UI with your coding agent on Velloo, a local canvas built from your app's own components: skills, commands and the Velloo MCP server.";
const KEYWORDS = ["design", "ui", "canvas", "mcp", "shadcn", "tailwind", "mui", "design-system"];
const AUTHOR = { name: "Velloo", url: "https://velloo.design" };
const HOMEPAGE = "https://velloo.design";
const REPOSITORY = `https://github.com/${PLUGIN_REPO}`;
const LICENSE = "Apache-2.0";

/** The MCP server every manifest starts: the CLI from npm, at this release. */
export function mcpLaunch(version: string): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", `velloo@${version}`, "mcp"] };
}

export function buildAgentPlugin(version: string, out: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`build-agent-plugin: "${version}" is not a release version`);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const copy = (from: string, to: string) =>
    cpSync(join(repoRoot, from), join(out, to), { recursive: true });
  const write = (path: string, value: unknown) => {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  };

  copy("skills", "skills");
  copy("plugins/claude/velloo/commands", "commands");
  copy("plugins/claude/velloo/agents", "agents");
  // Gemini reads only `.toml` under commands/, Claude and Cursor only Markdown.
  copy("plugins/gemini/commands/velloo", "commands/velloo");
  copy("plugins/gemini/GEMINI.md", "GEMINI.md");
  copy(".github/assets/velloo-mark.svg", "assets/logo.svg");
  copy("LICENSE", "LICENSE");

  const launch = mcpLaunch(version);
  const common = {
    name: "velloo",
    version,
    description: DESCRIPTION,
    author: AUTHOR,
    homepage: HOMEPAGE,
    repository: REPOSITORY,
    license: LICENSE,
    keywords: KEYWORDS,
  };

  // Agent Plugins 1.0 — Codex, Copilot, Cursor, Kiro, Devin.
  write("plugin.json", {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    ...common,
  });
  write("mcp.json", {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { velloo: { type: "stdio", ...launch } },
  });

  // Claude Code, and the agents that read its marketplace (Copilot CLI,
  // Factory Droid, Devin).
  write(".claude-plugin/plugin.json", common);
  write(".mcp.json", { mcpServers: { velloo: launch } });
  write(".claude-plugin/marketplace.json", {
    name: MARKETPLACE,
    owner: AUTHOR,
    description: "The Velloo design canvas for your coding agent.",
    plugins: [{ name: "velloo", source: "./", description: DESCRIPTION, version }],
  });

  // Codex reads its own marketplace file first, and requires `policy` there.
  write(".agents/plugins/marketplace.json", {
    name: MARKETPLACE,
    interface: { displayName: "Velloo" },
    plugins: [
      {
        name: "velloo",
        source: { source: "local", path: "./" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  });

  write(".cursor-plugin/plugin.json", {
    name: "velloo",
    version,
    description: DESCRIPTION,
    author: { name: AUTHOR.name },
    homepage: HOMEPAGE,
    repository: REPOSITORY,
    license: LICENSE,
    keywords: KEYWORDS,
    logo: "assets/logo.svg",
  });

  write(".antigravity-plugin/plugin.json", {
    $schema: "https://antigravity.google/schemas/v1/plugin.json",
    ...common,
    displayName: "Velloo",
    logo: "assets/logo.svg",
    suggestedPrompts: [
      "Set Velloo up for this app",
      "Explore three directions for the settings page on the Velloo canvas",
      "Implement the design I chose in Velloo",
    ],
  });
  write("mcp_config.json", { mcpServers: { velloo: launch } });

  write("gemini-extension.json", {
    name: "velloo",
    version,
    description: DESCRIPTION,
    mcpServers: { velloo: launch },
    contextFileName: "GEMINI.md",
  });

  write("README.md", readme(version));
}

function readme(version: string): string {
  return `# Velloo plugin

[Velloo](https://velloo.design) is a local design canvas for your coding agent. The agent
composes screens from your app's own components, you compare and comment on them side by
side, and the one you choose goes back to the agent as code in your app's idiom.

This plugin adds Velloo's skills, commands and MCP server to your agent. It is generated
from [velloo-design/velloo](https://github.com/velloo-design/velloo) on every release;
open issues and pull requests there. This is version ${version}.

## Install

**Claude Code**

\`\`\`bash
claude plugin install velloo --marketplace ${PLUGIN_REPO}
\`\`\`

**Codex**

\`\`\`bash
codex plugin marketplace add ${PLUGIN_REPO}
\`\`\`

Then install Velloo from \`/plugins\`.

**GitHub Copilot CLI**

\`\`\`bash
copilot plugin install ${PLUGIN_REPO}
\`\`\`

In VS Code, run **Chat: Install Plugin from Source** and enter \`${PLUGIN_REPO}\`.

**Cursor**: in the agent chat, run \`/add-plugin https://github.com/${PLUGIN_REPO}\`.

**Gemini CLI**

\`\`\`bash
gemini extensions install https://github.com/${PLUGIN_REPO}
\`\`\`

**Antigravity**

\`\`\`bash
agy plugin install https://github.com/${PLUGIN_REPO}
\`\`\`

**Factory Droid**

\`\`\`bash
droid plugin marketplace add ${PLUGIN_REPO}
droid plugin install velloo@${MARKETPLACE}
\`\`\`

**Any agent that reads skills** (Amp, opencode, Zed and others):

\`\`\`bash
npx skills add ${PLUGIN_REPO}
\`\`\`

Skills alone don't start the MCP server; run \`npx velloo connect\` in your project to wire
it into your agent.

## Get started

The MCP server runs \`npx -y velloo@${version} mcp\`, so Node.js 18 or later is the only
requirement; the first start downloads Velloo. In your project, ask your agent to
**set up Velloo for this app** (\`/velloo:setup\` where your agent has commands). When the
project has no design yet, the agent asks you, then creates one with \`velloo init\`.

If you already ran \`velloo connect\` for an agent, it wired the same server into that
agent's own config. Use one or the other there, so the agent doesn't see Velloo's tools
twice.

## License

Apache-2.0. The Velloo name and mark are trademarks and are not covered by the license; see
[TRADEMARK.md](https://github.com/velloo-design/velloo/blob/main/TRADEMARK.md).
`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { version: { type: "string" }, out: { type: "string" } },
  });
  if (!values.version) throw new Error("build-agent-plugin: pass --version X.Y.Z");
  const out = resolve(values.out ?? join(repoRoot, "release-artifacts", "agent-plugin"));
  buildAgentPlugin(values.version, out);
  if (!existsSync(join(out, "skills"))) throw new Error("build-agent-plugin: no skills copied");
  console.error(`build-agent-plugin: wrote ${out}`);
}
