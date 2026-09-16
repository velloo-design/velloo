import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../connect/index.ts";
import { agentRootCandidates } from "../connect/project-root.ts";
import { registerDesign } from "../manifest.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";

let tmp: string;
let design: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-connect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  design = join(tmp, "design");
  await mkdir(design, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const MCP = "http://127.0.0.1:7301/mcp";
// design = tmp/design, projectRoot falls back to tmp (no package.json), so the
// folder is wired relative to the project root.
const STDIO = { command: "velloo", args: ["mcp", "design"] };
// Global configs omit the folder arg — one entry serves every project.
const GLOBAL_STDIO = { command: "velloo", args: ["mcp"] };

describe("connect", () => {
  test("writes a Claude Code .mcp.json with a stdio command by default", async () => {
    const r = await connect({ designFolder: design, agents: ["claude-code"], installSkill: false });
    expect(r.unknownAgents).toEqual([]);
    expect(r.transport).toBe("stdio");
    expect(r.configs[0]?.action).toBe("created");
    const cfg = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    expect(cfg.mcpServers.velloo).toEqual(STDIO);
  });

  test("writes a Cursor .cursor/mcp.json with a stdio command by default", async () => {
    await connect({ designFolder: design, agents: ["cursor"], installSkill: false });
    const cfg = JSON.parse(await readFile(join(tmp, ".cursor", "mcp.json"), "utf8"));
    expect(cfg.mcpServers.velloo).toEqual(STDIO);
  });

  test("--http wires the HTTP transport (Claude needs type, Cursor a bare url)", async () => {
    await connect({
      designFolder: design,
      agents: ["claude-code"],
      transport: "http",
      installSkill: false,
    });
    const claude = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    expect(claude.mcpServers.velloo).toEqual({ type: "http", url: MCP });

    await connect({
      designFolder: design,
      agents: ["cursor"],
      transport: "http",
      installSkill: false,
    });
    const cursor = JSON.parse(await readFile(join(tmp, ".cursor", "mcp.json"), "utf8"));
    expect(cursor.mcpServers.velloo).toEqual({ url: MCP });
  });

  test("is idempotent and preserves other servers + top-level keys", async () => {
    await writeFile(
      join(tmp, ".mcp.json"),
      JSON.stringify({
        mcpServers: { other: { command: "x" } },
        someOtherSetting: true,
      }),
    );
    const r = await connect({ designFolder: design, agents: ["claude-code"], installSkill: false });
    expect(r.configs[0]?.action).toBe("updated");
    const cfg = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    // velloo added, the other server and the unrelated key survive.
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(cfg.mcpServers.velloo).toEqual(STDIO);
    expect(cfg.someOtherSetting).toBe(true);

    // Re-running doesn't duplicate or drift.
    await connect({ designFolder: design, agents: ["claude-code"], installSkill: false });
    const again = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    expect(Object.keys(again.mcpServers).sort()).toEqual(["other", "velloo"]);
  });

  test("honors a custom mcpUrl with --http", async () => {
    await connect({
      designFolder: design,
      agents: ["claude-code"],
      transport: "http",
      mcpUrl: "http://127.0.0.1:9000/mcp",
      installSkill: false,
    });
    const cfg = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    expect(cfg.mcpServers.velloo.url).toBe("http://127.0.0.1:9000/mcp");
  });

  test("writes config at the nearest package.json ancestor", async () => {
    // tmp/ has a package.json; design is tmp/nested/design.
    await writeFile(join(tmp, "package.json"), "{}");
    const nestedDesign = join(tmp, "nested", "design");
    await mkdir(nestedDesign, { recursive: true });
    const r = await connect({
      designFolder: nestedDesign,
      agents: ["claude-code"],
      installSkill: false,
    });
    expect(r.projectRoot).toBe(tmp);
    expect(r.configs[0]?.path).toBe(join(tmp, ".mcp.json"));
  });

  test("a listed design wires at the velloo.json root, without pinning its name", async () => {
    // A monorepo whose app has its own package.json: the agent is opened at
    // the repo root, so that's where the config has to be.
    await mkdir(join(tmp, ".git"), { recursive: true });
    await writeFile(join(tmp, "package.json"), "{}");
    const app = join(tmp, "frontend");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "package.json"), "{}");
    for (const folder of [join(tmp, "velloo"), join(app, "velloo")]) {
      await rm(join(tmp, "velloo.json"), { force: true });
      await mkdir(join(folder, ".design"), { recursive: true });
      await writeFile(
        join(folder, ".design", "config.json"),
        JSON.stringify(buildDefaultConfig({ name: "frontend" })),
      );
      await registerDesign(folder, app);
      const r = await connect({
        designFolder: folder,
        agents: ["claude-code"],
        installSkill: false,
      });
      expect(r.projectRoot).toBe(tmp);
      const cfg = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
      // `velloo mcp` finds a listed design from the agent's cwd, and a pinned
      // name would go stale the moment the design is renamed.
      expect(cfg.mcpServers.velloo).toEqual({ command: "velloo", args: ["mcp"] });
    }
    // Earlier versions wired the nested folder at the app; upgrade still finds it.
    expect(await agentRootCandidates(join(app, "velloo"))).toEqual([tmp, app]);
  });

  test("falls back to the design folder's parent when no package.json exists", async () => {
    const r = await connect({ designFolder: design, agents: ["claude-code"], installSkill: false });
    expect(r.projectRoot).toBe(tmp);
  });

  test("reports unknown agents instead of writing them", async () => {
    const r = await connect({ designFolder: design, agents: ["bootstrap"], installSkill: false });
    expect(r.unknownAgents).toEqual(["bootstrap"]);
    expect(r.configs).toEqual([]);
  });

  test("global agents write under the injected home dir", async () => {
    const fakeHome = join(tmp, "home");
    await mkdir(fakeHome, { recursive: true });
    const r = await connect({
      designFolder: design,
      agents: ["claude-code-global", "cursor-global"],
      installSkill: false,
      homeDir: fakeHome,
    });
    expect(r.configs.map((c) => c.path).sort()).toEqual(
      [join(fakeHome, ".claude.json"), join(fakeHome, ".cursor", "mcp.json")].sort(),
    );
    // Global configs omit the folder arg — `velloo mcp` resolves it per-project
    // from the cwd, since one global entry serves every project.
    const cfg = JSON.parse(await readFile(join(fakeHome, ".claude.json"), "utf8"));
    expect(cfg.mcpServers.velloo).toEqual({ command: "velloo", args: ["mcp"] });
  });

  test("writes a Codex .codex/config.toml with a stdio [mcp_servers.velloo] table", async () => {
    const r = await connect({ designFolder: design, agents: ["codex"], installSkill: false });
    expect(r.configs[0]?.action).toBe("created");
    const toml = await readFile(join(tmp, ".codex", "config.toml"), "utf8");
    const cfg = Bun.TOML.parse(toml) as { mcp_servers: Record<string, unknown> };
    expect(cfg.mcp_servers.velloo).toEqual(STDIO);
  });

  test("Codex --http wires a bare url; global lands in ~/.codex/config.toml", async () => {
    const fakeHome = join(tmp, "home");
    await connect({
      designFolder: design,
      agents: ["codex-global"],
      transport: "http",
      installSkill: false,
      homeDir: fakeHome,
    });
    const toml = await readFile(join(fakeHome, ".codex", "config.toml"), "utf8");
    const cfg = Bun.TOML.parse(toml) as { mcp_servers: Record<string, unknown> };
    expect(cfg.mcp_servers.velloo).toEqual({ url: MCP });
  });

  test("Codex merge preserves comments, other servers, and unknown keys", async () => {
    await mkdir(join(tmp, ".codex"), { recursive: true });
    const existing = [
      "# my hand-tuned codex config",
      'model = "gpt-5.2"',
      "",
      "[mcp_servers.velloo]",
      'command = "stale"',
      'args = ["old"]',
      "",
      "[mcp_servers.velloo.env]",
      'STALE = "1"',
      "",
      "[mcp_servers.other]",
      'command = "x"',
      "",
    ].join("\n");
    await writeFile(join(tmp, ".codex", "config.toml"), existing);

    const r = await connect({ designFolder: design, agents: ["codex"], installSkill: false });
    expect(r.configs[0]?.action).toBe("updated");
    const toml = await readFile(join(tmp, ".codex", "config.toml"), "utf8");
    // The user's comment survives byte-for-byte — merge is a splice, not a re-serialize.
    expect(toml).toContain("# my hand-tuned codex config");
    const cfg = Bun.TOML.parse(toml) as {
      model: string;
      mcp_servers: Record<string, unknown>;
    };
    expect(cfg.model).toBe("gpt-5.2");
    expect(cfg.mcp_servers.other).toEqual({ command: "x" });
    // velloo replaced wholesale — the stale subtable is gone too.
    expect(cfg.mcp_servers.velloo).toEqual(STDIO);

    // Re-running doesn't duplicate or drift.
    await connect({ designFolder: design, agents: ["codex"], installSkill: false });
    const again = await readFile(join(tmp, ".codex", "config.toml"), "utf8");
    expect(again).toBe(toml);
  });

  test("Codex merge refuses to clobber an unparseable config.toml", async () => {
    await mkdir(join(tmp, ".codex"), { recursive: true });
    await writeFile(join(tmp, ".codex", "config.toml"), "[broken\nnot toml");
    await expect(
      connect({ designFolder: design, agents: ["codex"], installSkill: false }),
    ).rejects.toThrow(/isn't valid TOML/);
    // Untouched.
    expect(await readFile(join(tmp, ".codex", "config.toml"), "utf8")).toBe("[broken\nnot toml");
  });

  test("writes a Continue workspace block at .continue/mcpServers/velloo.yaml", async () => {
    await connect({ designFolder: design, agents: ["continue"], installSkill: false });
    const yaml = await readFile(join(tmp, ".continue", "mcpServers", "velloo.yaml"), "utf8");
    const cfg = Bun.YAML.parse(yaml) as {
      name: string;
      schema: string;
      mcpServers: Record<string, unknown>[];
    };
    // Standalone Continue blocks require the name/version/schema metadata.
    expect(cfg.name).toBe("velloo");
    expect(cfg.schema).toBe("v1");
    expect(cfg.mcpServers).toEqual([{ name: "velloo", type: "stdio", ...STDIO }]);
  });

  test("Continue --http declares streamable-http (velloo's HTTP MCP transport)", async () => {
    await connect({
      designFolder: design,
      agents: ["continue"],
      transport: "http",
      installSkill: false,
    });
    const yaml = await readFile(join(tmp, ".continue", "mcpServers", "velloo.yaml"), "utf8");
    const cfg = Bun.YAML.parse(yaml) as { mcpServers: Record<string, unknown>[] };
    expect(cfg.mcpServers).toEqual([{ name: "velloo", type: "streamable-http", url: MCP }]);
  });

  test("Continue global merges into ~/.continue/config.yaml, preserving the rest", async () => {
    const fakeHome = join(tmp, "home");
    await mkdir(join(fakeHome, ".continue"), { recursive: true });
    await writeFile(
      join(fakeHome, ".continue", "config.yaml"),
      [
        "name: My Assistant",
        "version: 2.1.0",
        "schema: v1",
        "models:",
        "  - name: claude",
        "    provider: anthropic",
        "mcpServers:",
        "  - name: other",
        "    command: x",
        "  - name: velloo",
        "    command: stale",
        "",
      ].join("\n"),
    );
    const r = await connect({
      designFolder: design,
      agents: ["continue-global"],
      installSkill: false,
      homeDir: fakeHome,
    });
    expect(r.configs[0]?.action).toBe("updated");
    const cfg = Bun.YAML.parse(
      await readFile(join(fakeHome, ".continue", "config.yaml"), "utf8"),
    ) as {
      name: string;
      version: string;
      models: unknown[];
      mcpServers: Record<string, unknown>[];
    };
    // Assistant metadata + models + the other server survive; velloo replaced.
    expect(cfg.name).toBe("My Assistant");
    expect(cfg.version).toBe("2.1.0");
    expect(cfg.models).toEqual([{ name: "claude", provider: "anthropic" }]);
    expect(cfg.mcpServers).toEqual([
      { name: "other", command: "x" },
      { name: "velloo", type: "stdio", command: "velloo", args: ["mcp"] },
    ]);
  });

  test("Continue global creates a minimal config.yaml when none exists", async () => {
    const fakeHome = join(tmp, "home");
    const r = await connect({
      designFolder: design,
      agents: ["continue-global"],
      installSkill: false,
      homeDir: fakeHome,
    });
    expect(r.configs[0]?.action).toBe("created");
    const cfg = Bun.YAML.parse(
      await readFile(join(fakeHome, ".continue", "config.yaml"), "utf8"),
    ) as { name: string; schema: string; mcpServers: Record<string, unknown>[] };
    // Continue requires the assistant header; velloo supplies its local default.
    expect(cfg.name).toBe("Local Assistant");
    expect(cfg.schema).toBe("v1");
    expect(cfg.mcpServers).toEqual([{ name: "velloo", type: "stdio", ...GLOBAL_STDIO }]);
  });

  test("opencode writes an `mcp` map with an argv-array command (project + global)", async () => {
    const fakeHome = join(tmp, "home");
    await connect({
      designFolder: design,
      agents: ["opencode", "opencode-global"],
      installSkill: false,
      homeDir: fakeHome,
    });
    const proj = JSON.parse(await readFile(join(tmp, "opencode.json"), "utf8"));
    expect(proj.$schema).toBe("https://opencode.ai/config.json");
    expect(proj.mcp.velloo).toEqual({
      type: "local",
      command: ["velloo", "mcp", "design"],
      enabled: true,
    });
    const glob = JSON.parse(
      await readFile(join(fakeHome, ".config", "opencode", "opencode.json"), "utf8"),
    );
    expect(glob.mcp.velloo).toEqual({ type: "local", command: ["velloo", "mcp"], enabled: true });
  });

  test("opencode merge preserves the user's providers and other mcp entries", async () => {
    await writeFile(
      join(tmp, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        provider: { lmstudio: { name: "LM Studio" } },
        mcp: { other: { type: "remote", url: "http://x/mcp" } },
      }),
    );
    const r = await connect({ designFolder: design, agents: ["opencode"], installSkill: false });
    expect(r.configs[0]?.action).toBe("updated");
    const cfg = JSON.parse(await readFile(join(tmp, "opencode.json"), "utf8"));
    expect(cfg.provider.lmstudio.name).toBe("LM Studio");
    expect(cfg.mcp.other).toEqual({ type: "remote", url: "http://x/mcp" });
    expect(cfg.mcp.velloo.type).toBe("local");
  });

  test("opencode --http wires a remote entry", async () => {
    await connect({
      designFolder: design,
      agents: ["opencode"],
      transport: "http",
      installSkill: false,
    });
    const cfg = JSON.parse(await readFile(join(tmp, "opencode.json"), "utf8"));
    expect(cfg.mcp.velloo).toEqual({ type: "remote", url: MCP, enabled: true });
  });

  test("droid writes ~/.factory/mcp.json with an explicit stdio type", async () => {
    const fakeHome = join(tmp, "home");
    await connect({
      designFolder: design,
      agents: ["droid-global"],
      installSkill: false,
      homeDir: fakeHome,
    });
    const cfg = JSON.parse(await readFile(join(fakeHome, ".factory", "mcp.json"), "utf8"));
    // Matches what `droid mcp add` itself writes.
    expect(cfg.mcpServers.velloo).toEqual({ type: "stdio", ...GLOBAL_STDIO, disabled: false });
  });

  test("cline writes ~/.cline/data/settings/cline_mcp_settings.json", async () => {
    const fakeHome = join(tmp, "home");
    await connect({
      designFolder: design,
      agents: ["cline-global"],
      installSkill: false,
      homeDir: fakeHome,
    });
    const cfg = JSON.parse(
      await readFile(
        join(fakeHome, ".cline", "data", "settings", "cline_mcp_settings.json"),
        "utf8",
      ),
    );
    expect(cfg.mcpServers.velloo).toEqual(GLOBAL_STDIO);
  });

  test("gemini writes settings.json; --http uses httpUrl (streamable HTTP)", async () => {
    const fakeHome = join(tmp, "home");
    await connect({
      designFolder: design,
      agents: ["gemini"],
      installSkill: false,
    });
    const proj = JSON.parse(await readFile(join(tmp, ".gemini", "settings.json"), "utf8"));
    expect(proj.mcpServers.velloo).toEqual(STDIO);
    await connect({
      designFolder: design,
      agents: ["gemini-global"],
      transport: "http",
      installSkill: false,
      homeDir: fakeHome,
    });
    const glob = JSON.parse(await readFile(join(fakeHome, ".gemini", "settings.json"), "utf8"));
    expect(glob.mcpServers.velloo).toEqual({ httpUrl: MCP });
  });

  test("windsurf writes ~/.codeium/windsurf/mcp_config.json", async () => {
    const fakeHome = join(tmp, "home");
    await connect({
      designFolder: design,
      agents: ["windsurf-global"],
      installSkill: false,
      homeDir: fakeHome,
    });
    const cfg = JSON.parse(
      await readFile(join(fakeHome, ".codeium", "windsurf", "mcp_config.json"), "utf8"),
    );
    expect(cfg.mcpServers.velloo).toEqual(GLOBAL_STDIO);
  });

  test("VS Code writes .vscode/mcp.json under a `servers` key with explicit type", async () => {
    await connect({ designFolder: design, agents: ["vscode"], installSkill: false });
    const cfg = JSON.parse(await readFile(join(tmp, ".vscode", "mcp.json"), "utf8"));
    expect(cfg.servers.velloo).toEqual({ type: "stdio", ...STDIO });
    expect(cfg.mcpServers).toBeUndefined();
  });

  test("Claude Desktop gets an absolute command and a pinned absolute folder", async () => {
    const fakeHome = join(tmp, "home");
    const r = await connect({
      designFolder: design,
      agents: ["claude-desktop"],
      installSkill: false,
      homeDir: fakeHome,
    });
    // GUI apps have no shell PATH (`#!/usr/bin/env bun` would fail) and no
    // meaningful cwd — the entry must be runnable from anywhere.
    const path = r.configs[0]?.path as string;
    expect(path).toContain("Claude");
    expect(path.endsWith("claude_desktop_config.json")).toBe(true);
    const cfg = JSON.parse(await readFile(path, "utf8"));
    const entry = cfg.mcpServers.velloo as { command: string; args: string[] };
    expect(entry.command).toBe(process.execPath);
    expect(entry.args.slice(-2)).toEqual(["mcp", design]);
  });

  test("Claude Desktop merge preserves the app's own preferences", async () => {
    const fakeHome = join(tmp, "home");
    const { claudeDesktopConfigPath } = await import("../connect/agents.ts");
    const cfgPath = claudeDesktopConfigPath(fakeHome);
    await mkdir(join(cfgPath, ".."), { recursive: true });
    await writeFile(cfgPath, JSON.stringify({ preferences: { menuBarEnabled: false } }));
    await connect({
      designFolder: design,
      agents: ["claude-desktop"],
      installSkill: false,
      homeDir: fakeHome,
    });
    const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
    expect(cfg.preferences).toEqual({ menuBarEnabled: false });
    expect(cfg.mcpServers.velloo).toBeDefined();
  });

  test("claude-code + installSkill materializes the local plugin marketplace", async () => {
    const fakeHome = join(tmp, "home");
    const r = await connect({
      designFolder: design,
      agents: ["claude-code"],
      installSkill: true,
      homeDir: fakeHome,
    });
    expect(r.plugin).toBeDefined();
    const mDir = join(fakeHome, ".velloo", "claude-plugins");
    expect(r.plugin?.marketplaceDir).toBe(mDir);

    const marketplace = JSON.parse(
      await readFile(join(mDir, ".claude-plugin", "marketplace.json"), "utf8"),
    );
    expect(marketplace.name).toBe("velloo");
    expect(marketplace.plugins[0]).toMatchObject({ name: "velloo", source: "./plugins/velloo" });

    // The plugin carries manifest + skills + commands + subagents.
    const pluginDir = join(mDir, "plugins", "velloo");
    const manifest = JSON.parse(
      await readFile(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest.name).toBe("velloo");
    const skill = await readFile(join(pluginDir, "skills", "velloo-design", "SKILL.md"), "utf8");
    expect(skill).toContain("name: velloo-design");
    expect(await Bun.file(join(pluginDir, "commands", "design.md")).exists()).toBe(true);
    expect(await Bun.file(join(pluginDir, "agents", "velloo-designer.md")).exists()).toBe(true);

    // Registered + enabled in the user's Claude settings — no /plugin gesture.
    const settings = JSON.parse(await readFile(join(fakeHome, ".claude", "settings.json"), "utf8"));
    expect(settings.extraKnownMarketplaces.velloo.source).toEqual({
      source: "directory",
      path: mDir,
    });
    expect(settings.enabledPlugins["velloo@velloo"]).toBe(true);
  });

  test("plugin registration preserves existing Claude settings", async () => {
    const fakeHome = join(tmp, "home");
    await mkdir(join(fakeHome, ".claude"), { recursive: true });
    await writeFile(
      join(fakeHome, ".claude", "settings.json"),
      JSON.stringify({
        model: "opus",
        enabledPlugins: { "other@somewhere": true },
        extraKnownMarketplaces: { corp: { source: { source: "github", repo: "corp/plugins" } } },
      }),
    );
    await connect({
      designFolder: design,
      agents: ["claude-code"],
      installSkill: true,
      homeDir: fakeHome,
    });
    const settings = JSON.parse(await readFile(join(fakeHome, ".claude", "settings.json"), "utf8"));
    expect(settings.model).toBe("opus");
    expect(settings.enabledPlugins["other@somewhere"]).toBe(true);
    expect(settings.enabledPlugins["velloo@velloo"]).toBe(true);
    expect(settings.extraKnownMarketplaces.corp).toEqual({
      source: { source: "github", repo: "corp/plugins" },
    });
  });

  test("SKILL.md-capable agents get the neutral .agents/skills copies", async () => {
    const fakeHome = join(tmp, "home");
    const r = await connect({
      designFolder: design,
      agents: ["opencode"],
      installSkill: true,
      homeDir: fakeHome,
    });
    expect(r.skills?.map((s) => s.name)).toContain("velloo-implement");
    const skill = await readFile(
      join(tmp, ".agents", "skills", "velloo-design", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: velloo-design");
    // opencode is not claude — no plugin, no cursor rule.
    expect(r.plugin).toBeUndefined();
    expect(r.cursorRules).toBeUndefined();
  });

  test("gemini gets the extension materialized under ~/.velloo (unlinked in tests)", async () => {
    const fakeHome = join(tmp, "home");
    const r = await connect({
      designFolder: design,
      agents: ["gemini-global"],
      installSkill: true,
      homeDir: fakeHome,
    });
    expect(r.geminiExtension?.dir).toBe(join(fakeHome, ".velloo", "gemini-extension"));
    // Linking only ever runs against the real home dir.
    expect(r.geminiExtension?.linked).toBe(false);
    const manifest = JSON.parse(
      await readFile(
        join(fakeHome, ".velloo", "gemini-extension", "gemini-extension.json"),
        "utf8",
      ),
    );
    expect(manifest.name).toBe("velloo");
    expect(manifest.mcpServers.velloo).toEqual({ command: "velloo", args: ["mcp"] });
    expect(
      await Bun.file(
        join(fakeHome, ".velloo", "gemini-extension", "skills", "velloo-design", "SKILL.md"),
      ).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(fakeHome, ".velloo", "gemini-extension", "GEMINI.md")).exists(),
    ).toBe(true);
  });

  test("cursor alone gets neither the plugin nor .agents skills", async () => {
    const fakeHome = join(tmp, "home");
    const r = await connect({
      designFolder: design,
      agents: ["cursor"],
      installSkill: true,
      homeDir: fakeHome,
    });
    expect(r.skills).toBeUndefined();
    expect(r.plugin).toBeUndefined();
    expect(r.geminiExtension).toBeUndefined();
    expect(r.cursorRules?.installed).toBe(true);
  });
});
