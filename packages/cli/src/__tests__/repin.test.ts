import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repinAgentConfigs } from "../connect/repin.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";

let tmp: string;
let design: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-repin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  design = join(tmp, "velloo");
  await mkdir(join(design, ".design"), { recursive: true });
  await writeFile(
    join(design, ".design", "config.json"),
    JSON.stringify(buildDefaultConfig({ name: "app" })),
  );
  await writeFile(join(tmp, "velloo.json"), JSON.stringify({ designs: ["velloo"] }));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<string> {
  const path = join(tmp, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  return path;
}

const repin = (names: string[] = ["app"]) =>
  repinAgentConfigs({ projectRoots: [tmp], designFolder: design, names, homeDir: tmp });

describe("repinAgentConfigs", () => {
  test("drops a 0.1.0 name pin from every project config format, keeping everything else", async () => {
    const pinned = { command: "velloo", args: ["mcp", "app"] };
    await write(
      ".mcp.json",
      JSON.stringify({ mcpServers: { velloo: pinned, other: { command: "x", args: [] } } }),
    );
    await write(".cursor/mcp.json", JSON.stringify({ mcpServers: { velloo: pinned } }));
    await write(
      ".vscode/mcp.json",
      JSON.stringify({ servers: { velloo: { type: "stdio", ...pinned } } }),
    );
    await write(
      "opencode.json",
      JSON.stringify({
        mcp: { velloo: { type: "local", command: ["velloo", "mcp", "app"], enabled: true } },
      }),
    );
    await write(
      ".codex/config.toml",
      '# mine\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.velloo]\ncommand = "velloo"\nargs = ["mcp", "app"]\n',
    );
    await write(
      ".continue/mcpServers/velloo.yaml",
      "name: velloo\nversion: 0.1.0\nschema: v1\nmcpServers:\n  - name: velloo\n    type: stdio\n    command: velloo\n    args:\n      - mcp\n      - app\n",
    );

    const rewritten = await repin();
    expect(rewritten.length).toBe(6);

    const claude = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    expect(claude.mcpServers.velloo).toEqual({ command: "velloo", args: ["mcp"] });
    expect(claude.mcpServers.other).toEqual({ command: "x", args: [] });
    const cursor = JSON.parse(await readFile(join(tmp, ".cursor/mcp.json"), "utf8"));
    expect(cursor.mcpServers.velloo.args).toEqual(["mcp"]);
    const vscode = JSON.parse(await readFile(join(tmp, ".vscode/mcp.json"), "utf8"));
    expect(vscode.servers.velloo.args).toEqual(["mcp"]);
    const opencode = JSON.parse(await readFile(join(tmp, "opencode.json"), "utf8"));
    expect(opencode.mcp.velloo.command).toEqual(["velloo", "mcp"]);
    const codex = await readFile(join(tmp, ".codex/config.toml"), "utf8");
    expect(codex).toContain("# mine");
    expect(Bun.TOML.parse(codex)).toMatchObject({
      mcp_servers: { other: { command: "x" }, velloo: { args: ["mcp"] } },
    });
    const block = Bun.YAML.parse(
      await readFile(join(tmp, ".continue/mcpServers/velloo.yaml"), "utf8"),
    ) as { mcpServers: { args: string[] }[] };
    expect(block.mcpServers[0]?.args).toEqual(["mcp"]);

    expect(await repin()).toEqual([]);
  });

  test("keeps the command a config already uses", async () => {
    await write(
      ".mcp.json",
      JSON.stringify({
        mcpServers: { velloo: { command: "/opt/velloo/bin/velloo", args: ["mcp", "app"] } },
      }),
    );
    await repin();
    const cfg = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    expect(cfg.mcpServers.velloo).toEqual({ command: "/opt/velloo/bin/velloo", args: ["mcp"] });
  });

  test("leaves a path pin, another name, and bare mcp alone", async () => {
    await write(
      ".mcp.json",
      JSON.stringify({ mcpServers: { velloo: { command: "velloo", args: ["mcp", "velloo"] } } }),
    );
    await write(
      ".cursor/mcp.json",
      JSON.stringify({ mcpServers: { velloo: { command: "velloo", args: ["mcp", "brand"] } } }),
    );
    await write(
      ".vscode/mcp.json",
      JSON.stringify({ servers: { velloo: { command: "velloo", args: ["mcp"] } } }),
    );
    expect(await repin()).toEqual([]);
  });

  test("a design no velloo.json lists is pinned by its folder instead of its name", async () => {
    await rm(join(tmp, "velloo.json"));
    await write(
      ".mcp.json",
      JSON.stringify({ mcpServers: { velloo: { command: "velloo", args: ["mcp", "app"] } } }),
    );
    await repin();
    const cfg = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    expect(cfg.mcpServers.velloo.args).toEqual(["mcp", "velloo"]);
  });
});
