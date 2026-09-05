import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../../live/component-bundler.ts";
import { LocalCommentsService } from "../../local-comments.ts";
import { TailwindJit } from "../../styles/tailwind-jit.ts";
import { testContext } from "../../testing/design-folder.ts";
import { runStdioMcpProxy } from "../proxy.ts";
import { createMcpServer, type McpServerHandle } from "../server.ts";

/**
 * The proxy is what every agent actually talks to: `velloo mcp` relays the
 * agent's stdio JSON-RPC to whichever canvas daemon owns the folder. Its hard
 * case is that the daemon's MCP port is ephemeral, so a daemon that dies and
 * respawns lands somewhere else and the transport built at proxy startup can
 * never reach it again — the failure that used to wedge a whole agent session
 * with a -32000 whose "retry" advice could not possibly succeed.
 *
 * These drive real daemons (createMcpServer) through the real proxy, with the
 * agent side on an in-memory transport instead of a subprocess's stdin.
 */

let folder: Awaited<ReturnType<typeof testContext>>;
const daemons: McpServerHandle[] = [];
let logged: string[] = [];

// Every failure path here logs a diagnostic on purpose, including from async
// teardown after a test ends. Capture for the whole file: it keeps the suite's
// output readable and turns the operator-facing message into something the
// tests can assert on.
const realConsoleError = console.error;
console.error = (...args: unknown[]) => {
  logged.push(args.map((arg) => String(arg)).join(" "));
};
afterAll(() => {
  console.error = realConsoleError;
});

/** Boot a real MCP daemon on an ephemeral port over the shared design folder. */
async function startDaemon(): Promise<McpServerHandle> {
  const { ctx, root } = folder;
  const handle = await createMcpServer(ctx, {
    port: 0,
    host: "127.0.0.1",
    jit: new TailwindJit(ctx.defaultProvider, join(root, "screens")),
    bundler: new LiveBundler(
      root,
      () => ctx.folder.config,
      () => liveExtensions(ctx.folder.config.extensions),
    ),
    canvasBundler: new CanvasBundler(
      root,
      () => ctx.folder.config.hostApp,
      () => undefined,
    ),
    comments: new LocalCommentsService(() => ctx, join(root, "comments.json")),
  });
  daemons.push(handle);
  return handle;
}

/** An MCP client wired to the proxy's agent side, standing in for the agent. */
async function agentThrough(
  url: string,
  opts: Parameters<typeof runStdioMcpProxy>[1] = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [agentSide, proxySide] = InMemoryTransport.createLinkedPair();
  const proxy = await runStdioMcpProxy(url, { ...opts, agentTransport: proxySide });
  const client = new Client({ name: "proxy-test", version: "0.0.0" });
  await client.connect(agentSide as Parameters<typeof client.connect>[0]);
  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await proxy.close().catch(() => undefined);
    },
  };
}

beforeEach(async () => {
  logged = [];
  folder = await testContext({ label: "mcp-proxy" });
});

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close().catch(() => undefined);
  await folder.cleanup();
});

describe("relaying to a live daemon", () => {
  test("passes the catalogue and a tool call straight through", async () => {
    const daemon = await startDaemon();
    const agent = await agentThrough(`${daemon.url}?surface=full`);
    try {
      const names = (await agent.client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("add_screen");

      await agent.client.callTool({ name: "add_screen", arguments: { name: "Relayed" } });
      expect(await Bun.file(join(folder.root, "screens", "relayed.json")).exists()).toBe(true);
    } finally {
      await agent.close();
    }
  });

  test("the daemon sees the proxy as one session", async () => {
    const daemon = await startDaemon();
    const agent = await agentThrough(daemon.url);
    try {
      await agent.client.listTools();
      expect(daemon.sessions()).toBe(1);
    } finally {
      await agent.close();
    }
  });
});

describe("surviving a daemon respawn", () => {
  test("re-discovers the new port and completes the call the dead daemon dropped", async () => {
    const first = await startDaemon();
    const second = await startDaemon();
    expect(new URL(second.url).port).not.toBe(new URL(first.url).port);

    let rediscovered = 0;
    const agent = await agentThrough(`${first.url}?surface=full`, {
      rediscover: async () => {
        rediscovered++;
        return `${second.url}?surface=full`;
      },
    });
    try {
      // Establish the session on the first daemon, then take it away — exactly
      // what a daemon crash + respawn on a fresh ephemeral port looks like.
      await agent.client.listTools();
      await first.close();

      const result = await agent.client.callTool({
        name: "add_screen",
        arguments: { name: "After Respawn" },
      });
      expect(JSON.stringify(result)).toContain("after-respawn");
      expect(rediscovered).toBe(1);
      // The replayed initialize established a real session on the new daemon.
      expect(second.sessions()).toBe(1);
      // The operator's log says where it landed, not just that something broke.
      expect(logged.join("\n")).toContain(`reconnected to the canvas daemon at ${second.url}`);
    } finally {
      await agent.close();
    }
  });

  test("keeps serving from the new daemon after the reconnect", async () => {
    const first = await startDaemon();
    const second = await startDaemon();
    const agent = await agentThrough(`${first.url}?surface=full`, {
      rediscover: async () => `${second.url}?surface=full`,
    });
    try {
      await agent.client.listTools();
      await first.close();
      await agent.client.callTool({ name: "add_screen", arguments: { name: "One" } });
      // A second call must ride the swapped-in transport without reconnecting
      // again — the swap has to stick.
      await agent.client.callTool({ name: "add_screen", arguments: { name: "Two" } });
      expect(second.sessions()).toBe(1);
      expect(await Bun.file(join(folder.root, "screens", "two.json")).exists()).toBe(true);
    } finally {
      await agent.close();
    }
  });

  test("concurrent calls through a dead daemon share one reconnect", async () => {
    const first = await startDaemon();
    const second = await startDaemon();
    let rediscovered = 0;
    const agent = await agentThrough(`${first.url}?surface=full`, {
      rediscover: async () => {
        rediscovered++;
        return `${second.url}?surface=full`;
      },
    });
    try {
      await agent.client.listTools();
      await first.close();

      const results = await Promise.all([
        agent.client.callTool({ name: "add_screen", arguments: { name: "Par One" } }),
        agent.client.callTool({ name: "add_screen", arguments: { name: "Par Two" } }),
        agent.client.callTool({ name: "add_screen", arguments: { name: "Par Three" } }),
      ]);
      for (const result of results) expect(JSON.stringify(result)).toContain("screenId");
      // Three failures, one respawn — not three racing daemons.
      expect(rediscovered).toBe(1);
    } finally {
      await agent.close();
    }
  });
});

describe("when the daemon can't be brought back", () => {
  test("errors just that request instead of tearing the session down", async () => {
    const first = await startDaemon();
    const second = await startDaemon();
    let allowRediscover = false;
    const agent = await agentThrough(`${first.url}?surface=full`, {
      rediscover: async () => (allowRediscover ? `${second.url}?surface=full` : null),
    });
    try {
      await agent.client.listTools();
      await first.close();

      await expect(
        agent.client.callTool({ name: "add_screen", arguments: { name: "Doomed" } }),
      ).rejects.toThrow(/could not be respawned/);

      // The agent's session is still alive: once a daemon is reachable again
      // the very next call goes through, no reconnect from the agent's side.
      allowRediscover = true;
      const recovered = await agent.client.callTool({
        name: "add_screen",
        arguments: { name: "Recovered" },
      });
      expect(JSON.stringify(recovered)).toContain("recovered");
    } finally {
      await agent.close();
    }
  });

  test("says the daemon merely failed when there is no rediscover hook at all", async () => {
    const daemon = await startDaemon();
    const agent = await agentThrough(`${daemon.url}?surface=full`);
    try {
      await agent.client.listTools();
      await daemon.close();
      await expect(
        agent.client.callTool({ name: "add_screen", arguments: { name: "No Hook" } }),
      ).rejects.toThrow(/forwarding to the canvas daemon failed/);
    } finally {
      await agent.close();
    }
  });
});

describe("lifecycle", () => {
  test("fires onExit when the agent side goes away", async () => {
    const daemon = await startDaemon();
    let exited = 0;
    const [agentSide, proxySide] = InMemoryTransport.createLinkedPair();
    const proxy = await runStdioMcpProxy(daemon.url, {
      agentTransport: proxySide,
      onExit: () => exited++,
    });
    await agentSide.close();
    await Bun.sleep(10);
    expect(exited).toBe(1);
    await proxy.close();
    // close() after an exit must not fire onExit a second time.
    expect(exited).toBe(1);
  });

  test("does not answer a notification with a JSON-RPC error", async () => {
    const daemon = await startDaemon();
    const [agentSide, proxySide] = InMemoryTransport.createLinkedPair();
    const seen: JSONRPCMessage[] = [];
    agentSide.onmessage = (msg) => seen.push(msg);
    const proxy = await runStdioMcpProxy(daemon.url, { agentTransport: proxySide });
    await agentSide.start();
    await daemon.close();

    // A notification has no id, so there is nothing to answer — the proxy must
    // log and stay quiet rather than inventing a reply.
    await agentSide.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} });
    await Bun.sleep(50);
    expect(seen).toEqual([]);
    await proxy.close();
  });
});
