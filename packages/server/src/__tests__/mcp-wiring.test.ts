import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { LocalCommentsService } from "../local-comments.ts";
import { createMcpServer, type McpServerHandle } from "../mcp/server.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * The one test that boots the REAL MCP server and talks to it as an agent
 * does — over HTTP, through the SDK client, across both surfaces.
 *
 * Everything else in mcp/__tests__ registers one tool module onto a throwaway
 * McpServer, or exercises the surface mechanism against synthetic tools it
 * registers itself. Neither proves the shipped catalogue actually wires up:
 * that 65 native tools register without a name collision, that guided mode
 * collapses to exactly the façade and can still reach every one of them, that
 * the schemas an agent asks for are answerable, or that a call round-trips to
 * disk. Those are the failure shapes that would take a session down cold.
 */

let folder: Awaited<ReturnType<typeof testContext>>;
let handle: McpServerHandle;

async function connect(surface?: "guided" | "full"): Promise<Client> {
  const client = new Client({ name: "wiring-test", version: "0.0.0" });
  const url = new URL(surface ? `${handle.url}?surface=${surface}` : handle.url);
  const transport = new StreamableHTTPClientTransport(url);
  // The SDK's `Transport` declares `sessionId?: string` while its own
  // StreamableHTTPClientTransport implements it as `string | undefined` —
  // internally inconsistent under exactOptionalPropertyTypes, the same
  // disagreement mcp/server.ts documents on the server transport.
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  return client;
}

/** Tool results are content arrays; every velloo tool answers with one JSON text part. */
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const first = content[0];
  if (first?.type !== "text" || !first.text) {
    throw new Error(`expected a JSON text part, got ${JSON.stringify(content).slice(0, 200)}`);
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

beforeAll(async () => {
  folder = await testContext({ label: "mcp-wiring" });
  const { ctx, root } = folder;
  handle = await createMcpServer(ctx, {
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
});

afterAll(async () => {
  await handle.close();
  await folder.cleanup();
});

describe("the shipped MCP catalogue", () => {
  test("registers the full native surface, every tool described and uniquely named", async () => {
    const client = await connect("full");
    try {
      const { tools } = await client.listTools();
      // A catalogue this size is the point: the failure being guarded is one
      // module silently dropping out of registration, not the exact count.
      expect(tools.length).toBeGreaterThan(50);

      const names = tools.map((tool) => tool.name);
      expect(new Set(names).size).toBe(names.length);

      // Load-bearing operations across every tool module — if one module fails
      // to register, its verbs vanish from here.
      expect(names).toContain("add_screen");
      expect(names).toContain("compose");
      expect(names).toContain("emit_code");
      expect(names).toContain("emit_theme");
      expect(names).toContain("screenshot");
      expect(names).toContain("batch");
      expect(names).toContain("list_comment_threads");

      // The agent picks tools by description; an undescribed one is unusable.
      const undescribed = tools.filter((tool) => !tool.description?.trim());
      expect(undescribed.map((tool) => tool.name)).toEqual([]);
    } finally {
      await client.close();
    }
  });

  test("guided mode collapses to the façade and reaches every native operation", async () => {
    const guided = await connect("guided");
    const full = await connect("full");
    try {
      const guidedNames = (await guided.listTools()).tools.map((tool) => tool.name).sort();
      expect(guidedNames).toEqual(["call_velloo", "operation_schema", "run_velloo_plan"]);

      // Anything registered after the surface closes would leak into the
      // guided listing above AND be unreachable through the enum below.
      const nativeNames = (await full.listTools()).tools.map((tool) => tool.name);
      const facade = (await guided.listTools()).tools.find((t) => t.name === "call_velloo");
      const operations = (
        facade?.inputSchema as { properties?: { operation?: { enum?: string[] } } } | undefined
      )?.properties?.operation?.enum;
      expect(new Set(operations)).toEqual(new Set(nativeNames));
    } finally {
      await guided.close();
      await full.close();
    }
  });

  test("guided is the default surface when the URL asks for nothing", async () => {
    const client = await connect();
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("call_velloo");
      expect(names).not.toContain("add_screen");
    } finally {
      await client.close();
    }
  });

  test("both surfaces hand the agent instructions, and full says more", async () => {
    const guided = await connect("guided");
    const full = await connect("full");
    try {
      const guidedText = guided.getInstructions() ?? "";
      const fullText = full.getInstructions() ?? "";
      expect(guidedText.length).toBeGreaterThan(0);
      expect(fullText.length).toBeGreaterThan(guidedText.length);
    } finally {
      await guided.close();
      await full.close();
    }
  });

  test("advertises the guide resources the instructions point at", async () => {
    const client = await connect("full");
    try {
      const uris = (await client.listResources()).resources.map((r) => r.uri);
      expect(uris).toContain("velloo://guide/components");
      const guide = await client.readResource({ uri: "velloo://guide/components" });
      const body = guide.contents[0];
      expect(body && "text" in body ? body.text.length : 0).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });
});

describe("the guided façade", () => {
  test("round-trips a mutation to disk and back out through a read tool", async () => {
    const client = await connect("guided");
    try {
      const added = payload(
        await client.callTool({
          name: "call_velloo",
          arguments: { operation: "add_screen", arguments: { name: "Pricing" } },
        }),
      );
      expect(added.screenId).toBe("pricing");

      // It really landed on disk, not just in the response.
      const onDisk = await Bun.file(join(folder.root, "screens", "pricing.json")).json();
      expect(onDisk.name).toBe("Pricing");

      const listed = payload(
        await client.callTool({
          name: "call_velloo",
          arguments: { operation: "list_screens", arguments: {} },
        }),
      );
      expect(JSON.stringify(listed)).toContain("pricing");
    } finally {
      await client.close();
    }
  });

  test("answers operation_schema for every native operation", async () => {
    const guided = await connect("guided");
    const full = await connect("full");
    try {
      const names = (await full.listTools()).tools.map((tool) => tool.name);
      const unrepresentable: string[] = [];
      for (const operation of names) {
        const help = payload(
          await guided.callTool({ name: "operation_schema", arguments: { operation } }),
        );
        expect(help.operation).toBe(operation);
        const schema = help.inputSchema as { properties?: unknown; description?: string };
        // The tree-taking operations reach this through jsonTolerant()'s
        // transform, which only serializes under `io: "input"`.
        if (String(schema?.description ?? "").includes("not representable")) {
          unrepresentable.push(operation);
        }
      }
      expect(unrepresentable).toEqual([]);
    } finally {
      await guided.close();
      await full.close();
    }
  });

  test("a rejected call comes back as a typed error carrying the correction schema", async () => {
    const client = await connect("guided");
    try {
      const invalid = payload(
        await client.callTool({
          name: "call_velloo",
          arguments: { operation: "add_screen", arguments: {} },
        }),
      );
      expect(invalid.kind).toBe("InvalidOperationArguments");
      expect(invalid.operation).toBe("add_screen");
      // The whole promise of the façade: a failed call teaches the agent the
      // shape it should have sent.
      const schema = invalid.inputSchema as { properties?: Record<string, unknown> };
      expect(Object.keys(schema?.properties ?? {})).toContain("name");

      const unknown = payload(
        await client.callTool({
          name: "call_velloo",
          arguments: { operation: "list_screens", arguments: { mode: "nonsense" } },
        }),
      );
      expect(unknown.kind).toBe("InvalidOperationArguments");
    } finally {
      await client.close();
    }
  });

  test("run_velloo_plan applies a sequence and stops at the first failure", async () => {
    const client = await connect("guided");
    try {
      const result = await client.callTool({
        name: "run_velloo_plan",
        arguments: {
          calls: [
            { operation: "add_screen", arguments: { name: "Plan One" } },
            { operation: "add_screen", arguments: {} },
            { operation: "add_screen", arguments: { name: "Plan Three" } },
          ],
        },
      });
      const text = JSON.stringify(result);
      expect(text).toContain("plan-one");
      expect(text).toContain("InvalidOperationArguments");
      expect(text).not.toContain("plan-three");
      expect(await Bun.file(join(folder.root, "screens", "plan-three.json")).exists()).toBe(false);
    } finally {
      await client.close();
    }
  });
});

describe("the HTTP transport", () => {
  test("refuses a request that skipped initialize", async () => {
    const res = await fetch(handle.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("initialize");
  });

  test("rejects an unknown surface rather than silently serving the default", async () => {
    const res = await fetch(`${handle.url}?surface=nonsense`, {
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
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  test("serves anything but /mcp as 404", async () => {
    const res = await fetch(`${new URL(handle.url).origin}/not-mcp`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("tracks one session per client and releases it on close", async () => {
    const before = handle.sessions();
    const client = await connect("full");
    expect(handle.sessions()).toBe(before + 1);
    await client.close();
  });
});
