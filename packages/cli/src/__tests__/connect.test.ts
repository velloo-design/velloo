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

  test("installs the Claude Code skill when requested", async () => {
    const r = await connect({ designFolder: design, agents: ["claude-code"], installSkill: true });
    expect(r.skill?.installed).toBe(true);
    const skillBody = await readFile(
      join(tmp, ".claude", "skills", "velloo-design", "SKILL.md"),
      "utf8",
    );
    expect(skillBody).toContain("name: velloo-design");
  });

  test("does not install the skill for a non-claude agent", async () => {
    const r = await connect({ designFolder: design, agents: ["cursor"], installSkill: true });
    expect(r.skill).toBeUndefined();
  });
});
