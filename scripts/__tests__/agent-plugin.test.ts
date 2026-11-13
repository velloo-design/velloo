import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildAgentPlugin, MARKETPLACE, mcpLaunch } from "../build-agent-plugin.ts";

const repoRoot = resolve(import.meta.dir, "../..");
const VERSION = "1.2.3";
const out = join(tmpdir(), `velloo-agent-plugin-${process.pid}`);
const json = (path: string) => JSON.parse(readFileSync(join(out, path), "utf8"));

beforeAll(() => buildAgentPlugin(VERSION, out));

describe("the public agent plugin", () => {
  test("carries every skill the repo ships", () => {
    const skills = (dir: string) =>
      readdirSync(dir).filter((name) => existsSync(join(dir, name, "SKILL.md")));
    expect(skills(join(out, "skills")).sort()).toEqual(skills(join(repoRoot, "skills")).sort());
  });

  test("starts the same pinned MCP server from every format", () => {
    const launch = mcpLaunch(VERSION);
    expect(launch.args).toEqual(["-y", `velloo@${VERSION}`, "mcp"]);
    expect(json("mcp.json").mcpServers.velloo).toEqual({ type: "stdio", ...launch });
    expect(json(".mcp.json").mcpServers.velloo).toEqual(launch);
    expect(json("mcp_config.json").mcpServers.velloo).toEqual(launch);
    expect(json("gemini-extension.json").mcpServers.velloo).toEqual(launch);
  });

  test("stamps the release version into every manifest", () => {
    for (const path of [
      "plugin.json",
      ".claude-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      ".antigravity-plugin/plugin.json",
      "gemini-extension.json",
    ]) {
      expect({ path, version: json(path).version }).toEqual({ path, version: VERSION });
      expect({ path, name: json(path).name }).toEqual({ path, name: "velloo" });
    }
    expect(json(".claude-plugin/marketplace.json").plugins[0].version).toBe(VERSION);
  });

  // The Agent Plugins schemas are closed: a field they don't list makes a
  // client reject the whole manifest.
  test("keeps the Agent Plugins manifests within their closed schemas", () => {
    const plugin = json("plugin.json");
    expect(plugin.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    const allowed = [
      "$schema",
      "name",
      "version",
      "description",
      "author",
      "homepage",
      "repository",
      "license",
      "keywords",
      "extensions",
    ];
    expect(Object.keys(plugin).filter((key) => !allowed.includes(key))).toEqual([]);
    expect(plugin.name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    expect(Object.keys(plugin.author).filter((k) => !["name", "email", "url"].includes(k))).toEqual(
      [],
    );

    const mcp = json("mcp.json");
    expect(Object.keys(mcp).sort()).toEqual(["$schema", "mcpServers"]);
    expect(mcp.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  });

  test("lists the plugin in the Claude and Codex marketplaces from the root", () => {
    const claude = json(".claude-plugin/marketplace.json");
    expect(claude.name).toBe(MARKETPLACE);
    expect(claude.plugins).toEqual([expect.objectContaining({ name: "velloo", source: "./" })]);

    const codex = json(".agents/plugins/marketplace.json");
    expect(codex.name).toBe(MARKETPLACE);
    expect(codex.plugins[0]).toMatchObject({
      name: "velloo",
      source: { source: "local", path: "./" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    });
  });

  test("keeps Gemini's TOML commands apart from the Markdown ones", () => {
    const markdown = readdirSync(join(out, "commands")).filter((name) => name.endsWith(".md"));
    const toml = readdirSync(join(out, "commands", "velloo"));
    expect(markdown).toContain("setup.md");
    expect(toml.every((name) => name.endsWith(".toml"))).toBe(true);
    expect(toml).toContain("setup.toml");
  });

  test("ships the logo the manifests point at, and the license", () => {
    expect(json(".cursor-plugin/plugin.json").logo).toBe("assets/logo.svg");
    expect(existsSync(join(out, "assets", "logo.svg"))).toBe(true);
    expect(readFileSync(join(out, "LICENSE"), "utf8")).toContain("Apache License");
  });

  test("refuses a version that isn't a release", () => {
    expect(() => buildAgentPlugin("main", join(out, "never"))).toThrow("not a release version");
  });
});
