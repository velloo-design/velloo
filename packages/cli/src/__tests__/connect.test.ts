import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../connect/index.ts";

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

  test("installs the Claude Code skills when requested", async () => {
    const r = await connect({ designFolder: design, agents: ["claude-code"], installSkill: true });
    expect(r.skills?.length).toBeGreaterThan(0);
    expect(r.skills?.map((s) => s.name)).toContain("velloo-design");
    const skillBody = await readFile(
      join(tmp, ".claude", "skills", "velloo-design", "SKILL.md"),
      "utf8",
    );
    expect(skillBody).toContain("name: velloo-design");
  });

  test("does not install skills for a non-claude agent", async () => {
    const r = await connect({ designFolder: design, agents: ["cursor"], installSkill: true });
    expect(r.skills).toBeUndefined();
  });
});
