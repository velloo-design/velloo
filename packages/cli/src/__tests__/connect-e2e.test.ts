import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerHandle } from "@velloo/server";
import { connect } from "../connect/index.ts";

/**
 * AC guard for `velloo connect`: for every agent target, the config it
 * writes points at an MCP endpoint that answers a live `initialize`.
 * Spinning the detached daemon in a test is impractical, so this boots the
 * same in-process server the daemon runs (`createServer` with the HTTP MCP
 * transport — exactly what `velloo mcp --http` attaches) and wires each
 * agent's config at it with `--http`; the stdio entries are the same URL
 * behind the `velloo mcp` proxy and are covered shape-wise in connect.test.ts.
 */

const sampleConfig = {
  schemaVersion: 2,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let design: string;
let server: ServerHandle;
let mcpUrl: string;

beforeAll(async () => {
  tmp = join(tmpdir(), `velloo-connect-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  design = join(tmp, "design");
  for (const d of [".design", "theme", "screens", "boards", "snippets"]) {
    await mkdir(join(design, d), { recursive: true });
  }
  await writeFile(join(design, ".design/config.json"), JSON.stringify(sampleConfig));
  await writeFile(join(design, "theme/default.json"), JSON.stringify(sampleTheme));

  server = await createServer({
    folder: design,
    port: 0,
    mcp: { transport: "http", port: 0 },
  });
  if (!server.mcpUrl) throw new Error("server did not attach an HTTP MCP transport");
  mcpUrl = server.mcpUrl;
});

afterAll(async () => {
  await server?.close();
  await rm(tmp, { recursive: true, force: true });
});

/** Speak enough MCP to prove the endpoint is alive: POST initialize, parse result. */
async function initializeAt(url: string): Promise<{ serverInfo?: { name?: string } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "velloo-connect-e2e", version: "0.0.0" },
      },
    }),
  });
  expect(res.ok).toBe(true);
  const text = await res.text();
  // Streamable HTTP may answer as JSON or as a one-event SSE stream.
  const payload = res.headers.get("content-type")?.includes("text/event-stream")
    ? (text.split("\n").find((l) => l.startsWith("data:")) ?? "data:{}").slice(5)
    : text;
  const json = JSON.parse(payload) as { result?: { serverInfo?: { name?: string } } };
  expect(json.result).toBeDefined();
  return json.result as { serverInfo?: { name?: string } };
}

describe("connect end-to-end (config → live MCP initialize)", () => {
  test("every agent target's written config points at a URL that answers initialize", async () => {
    const home = join(tmp, "home");
    await connect({
      designFolder: design,
      agents: [
        "claude-code",
        "cursor",
        "codex",
        "continue",
        "claude-code-global",
        "cursor-global",
        "codex-global",
        "continue-global",
      ],
      transport: "http",
      mcpUrl,
      installSkill: false,
      homeDir: home,
    });

    const claude = JSON.parse(await readFile(join(tmp, ".mcp.json"), "utf8"));
    const cursor = JSON.parse(await readFile(join(tmp, ".cursor", "mcp.json"), "utf8"));
    const codex = Bun.TOML.parse(await readFile(join(tmp, ".codex", "config.toml"), "utf8")) as {
      mcp_servers: { velloo: { url: string } };
    };
    const cont = Bun.YAML.parse(
      await readFile(join(tmp, ".continue", "mcpServers", "velloo.yaml"), "utf8"),
    ) as { mcpServers: { name: string; url: string }[] };
    const claudeG = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
    const cursorG = JSON.parse(await readFile(join(home, ".cursor", "mcp.json"), "utf8"));
    const codexG = Bun.TOML.parse(await readFile(join(home, ".codex", "config.toml"), "utf8")) as {
      mcp_servers: { velloo: { url: string } };
    };
    const contG = Bun.YAML.parse(
      await readFile(join(home, ".continue", "config.yaml"), "utf8"),
    ) as { mcpServers: { name: string; url: string }[] };

    const urls = [
      claude.mcpServers.velloo.url,
      cursor.mcpServers.velloo.url,
      codex.mcp_servers.velloo.url,
      cont.mcpServers.find((s) => s.name === "velloo")?.url,
      claudeG.mcpServers.velloo.url,
      cursorG.mcpServers.velloo.url,
      codexG.mcp_servers.velloo.url,
      contG.mcpServers.find((s) => s.name === "velloo")?.url,
    ];
    for (const url of urls) expect(url).toBe(mcpUrl);

    // One handshake proves the endpoint every config points at is live.
    const result = await initializeAt(mcpUrl);
    expect(result.serverInfo?.name).toBeDefined();
  }, 30_000);
});
