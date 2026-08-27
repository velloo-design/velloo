import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";

/**
 * `velloo mcp` on a folder whose on-disk format is older than the binary must
 * NOT die (the agent that spawned it can't read stderr — it would just see a
 * dead MCP server). It serves the upgrade gate instead: instructions that
 * explain the mismatch plus an `upgrade_design_folder` tool that runs the
 * same migration as `velloo upgrade`.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** A valid legacy (schema v1) folder that migrates cleanly — mirrors upgrade.test.ts. */
async function legacyFolder(): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), "velloo-mcp-gate-"));
  const root = join(tmp, "velloo");
  await mkdir(join(root, ".design"), { recursive: true });
  await mkdir(join(root, "screens"), { recursive: true });
  await mkdir(join(root, "theme"), { recursive: true });
  await writeFile(
    join(root, ".design", "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      toolVersion: "0.0.1 (legacy)",
      library: {
        id: "shadcn-react",
        version: "2026.05.22",
        source: "embedded:shadcn",
        componentsPath: "binary",
      },
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    }),
  );
  await writeFile(
    join(root, "theme", "default.json"),
    JSON.stringify({
      name: "Test",
      colors: { background: "#fff", foreground: "#111", primary: "#06f" },
      typography: {},
      spacing: {},
      radius: {},
    }),
  );
  await writeFile(
    join(root, "screens", "home.json"),
    JSON.stringify({ id: "home", name: "Home", tree: { $ref: "Box" } }),
  );
  return root;
}

interface McpSession {
  send(msg: object): void;
  next(): Promise<Record<string, unknown>>;
  end(): Promise<number>;
}

function openSession(folder: string): McpSession {
  const proc = Bun.spawn(["bun", cliPath, "mcp", folder], {
    cwd: tmp,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, VELLOO_DAEMONS_PATH: join(tmp, "daemons.json") },
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return {
    send(msg) {
      proc.stdin.write(`${JSON.stringify(msg)}\n`);
      proc.stdin.flush();
    },
    async next() {
      while (true) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) return JSON.parse(line) as Record<string, unknown>;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("MCP server closed stdout before replying");
        buf += decoder.decode(value);
      }
    },
    async end() {
      proc.stdin.end();
      return await proc.exited;
    },
  };
}

describe("mcp format gate", () => {
  test("serves instructions + upgrade tool for an outdated folder, and the tool migrates it", async () => {
    const root = await legacyFolder();
    const session = openSession(root);

    session.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    const init = (await session.next()) as {
      result: { instructions: string; serverInfo: { name: string } };
    };
    expect(init.result.serverInfo.name).toBe("velloo");
    expect(init.result.instructions).toContain("format v1");
    expect(init.result.instructions).toContain("upgrade_design_folder");
    session.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    session.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const list = (await session.next()) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["upgrade_design_folder"]);

    session.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "upgrade_design_folder", arguments: {} },
    });
    const call = (await session.next()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(call.result.isError).toBeFalsy();
    expect(call.result.content[0]?.text).toContain("Migrated");
    expect(call.result.content[0]?.text).toContain("reconnect");

    const config = JSON.parse(await readFile(join(root, ".design", "config.json"), "utf8"));
    expect(config.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    expect(await session.end()).toBe(0);
  }, 30_000);

  test("a folder from a newer velloo gets instructions but no migration tool", async () => {
    const root = await legacyFolder();
    const configPath = join(root, ".design", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
    await writeFile(configPath, JSON.stringify(config));
    const session = openSession(root);

    session.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    const init = (await session.next()) as { result: { instructions: string } };
    expect(init.result.instructions).toContain("NEWER velloo");
    expect(init.result.instructions).not.toContain("upgrade_design_folder");

    expect(await session.end()).toBe(0);
  }, 30_000);
});
