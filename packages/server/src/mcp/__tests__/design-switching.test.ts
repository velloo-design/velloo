import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { loadDesignFolder } from "../../design-folder.ts";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../../live/component-bundler.ts";
import { LocalCommentsService } from "../../local-comments.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { TailwindJit } from "../../styles/tailwind-jit.ts";
import { scaffoldDesignFolder } from "../../testing/design-folder.ts";
import { runStdioMcpProxy } from "../proxy.ts";
import { createMcpServer, type McpServerHandle } from "../server.ts";

/**
 * One daemon serves one design, so an agent session is bound to the design it
 * opened on. In a checkout with several, the session is told which one it has
 * and what else exists, and — through the stdio proxy — can move to another.
 * With a single design none of that appears.
 *
 * These boot a real daemon per design and drive them as an agent does.
 */

let repo: string;
const daemons: McpServerHandle[] = [];

// Switches log where they landed; keep the suite's output readable.
const realConsoleError = console.error;
console.error = () => {};
afterAll(() => {
  console.error = realConsoleError;
});

async function designAt(path: string, name: string, screen: string): Promise<string> {
  const scaffolded = await scaffoldDesignFolder({
    label: "switch",
    config: { name },
    screens: { [screen]: true },
  });
  await mkdir(join(path, ".."), { recursive: true });
  await rename(scaffolded.root, path);
  return path;
}

async function daemonFor(root: string): Promise<McpServerHandle> {
  const provider = createShadcnProvider();
  const ctx: MutationContext = {
    folder: await loadDesignFolder(root),
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => {},
  };
  const handle = await createMcpServer(ctx, {
    port: 0,
    host: "127.0.0.1",
    jit: new TailwindJit(provider, join(root, "screens")),
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

async function direct(url: string): Promise<Client> {
  const client = new Client({ name: "designs-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  return client;
}

function texts(result: unknown): string[] {
  return ((result as { content?: { type: string; text?: string }[] }).content ?? []).map(
    (part) => part.text ?? "",
  );
}

beforeEach(async () => {
  repo = join(tmpdir(), `velloo-designs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(repo, { recursive: true });
});

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close().catch(() => undefined);
  await rm(repo, { recursive: true, force: true });
});

describe("a single design", () => {
  test("adds no design instructions and no design operations", async () => {
    const web = await designAt(join(repo, "web"), "web", "home");
    await writeFile(join(repo, "velloo.json"), JSON.stringify({ designs: ["web"] }));
    const client = await direct(`${(await daemonFor(web)).url}?surface=full&switch=1`);
    try {
      expect(client.getInstructions()).not.toContain("**Design:");
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain("list_designs");
      expect(names).not.toContain("switch_design");
    } finally {
      await client.close();
    }
  });
});

describe("several designs", () => {
  let web: string;
  let brand: string;

  beforeEach(async () => {
    web = await designAt(join(repo, "apps/web/velloo"), "web", "home");
    brand = await designAt(join(repo, "brand"), "brand", "logo");
    await writeFile(
      join(repo, "velloo.json"),
      JSON.stringify({ designs: ["apps/web/velloo", "brand"] }),
    );
  });

  test("the session is told which design it has and what else exists", async () => {
    const client = await direct(`${(await daemonFor(web)).url}?surface=full&switch=1`);
    try {
      const instructions = client.getInstructions() ?? "";
      expect(instructions).toContain("**Design: `web`**");
      expect(instructions).toContain("`brand`");
      expect(instructions).toContain("`switch_design`");

      const listed = await client.callTool({ name: "list_designs", arguments: {} });
      const { designs } = JSON.parse(texts(listed)[0] ?? "{}") as {
        designs: { name: string; path: string; current: boolean; screens: number }[];
      };
      expect(designs).toEqual([
        expect.objectContaining({ name: "brand", path: "brand", current: false, screens: 1 }),
        expect.objectContaining({ name: "web", path: "apps/web/velloo", current: true }),
      ]);
    } finally {
      await client.close();
    }
  });

  test("a connection no proxy can move gets no switch_design, and is told how to reconnect", async () => {
    const client = await direct(`${(await daemonFor(web)).url}?surface=full`);
    try {
      expect(client.getInstructions()).toContain("reconnects with `velloo mcp <name>`");
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("list_designs");
      expect(names).not.toContain("switch_design");
    } finally {
      await client.close();
    }
  });

  test("an arbitrary pick is flagged so the agent confirms before editing", async () => {
    const client = await direct(`${(await daemonFor(brand)).url}?switch=1&pick=arbitrary`);
    try {
      expect(client.getInstructions()).toContain("No design was specified");
    } finally {
      await client.close();
    }
  });

  describe("switching through the proxy", () => {
    async function agent(switchTo: Parameters<typeof runStdioMcpProxy>[1]) {
      const webDaemon = await daemonFor(web);
      const [agentSide, proxySide] = InMemoryTransport.createLinkedPair();
      const proxy = await runStdioMcpProxy(`${webDaemon.url}?surface=guided&switch=1`, {
        ...switchTo,
        agentTransport: proxySide,
      });
      const client = new Client({ name: "switch-test", version: "0.0.0" });
      let listChanged = 0;
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        listChanged++;
      });
      await client.connect(agentSide as Parameters<typeof client.connect>[0]);
      return {
        client,
        webDaemon,
        listChanged: () => listChanged,
        close: async () => {
          await client.close().catch(() => undefined);
          await proxy.close().catch(() => undefined);
        },
      };
    }

    const call = (client: Client, operation: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name: "call_velloo", arguments: { operation, arguments: args } });

    const screenIds = async (client: Client) => {
      const { screens } = JSON.parse(texts(await call(client, "list_screens"))[0] ?? "{}") as {
        screens: { id: string }[];
      };
      return screens.map((s) => s.id);
    };

    test("moves every later call to the other design and hands over its instructions", async () => {
      const brandDaemon = await daemonFor(brand);
      const session = await agent({
        switchTo: async (root) =>
          root === brand ? { url: `${brandDaemon.url}?surface=guided&switch=1` } : { error: "?" },
      });
      try {
        expect(await screenIds(session.client)).toEqual(["home"]);

        const switched = await call(session.client, "switch_design", { name: "brand" });
        const [status, instructions] = texts(switched);
        expect(JSON.parse(status ?? "{}")).toEqual({ kind: "DesignSwitched", name: "brand" });
        // Which design comes first — before even the bare-folder setup order.
        expect(instructions?.startsWith("**Design: `brand`**")).toBe(true);

        expect(await screenIds(session.client)).toEqual(["logo"]);
        await Bun.sleep(20);
        expect(session.listChanged()).toBe(1);
        // The design it left no longer counts this session.
        expect(session.webDaemon.sessions()).toBe(0);
      } finally {
        await session.close();
      }
    });

    test("a switch that can't reach the other design leaves the session where it was", async () => {
      const session = await agent({
        switchTo: async () => ({ error: "Run `velloo upgrade` to migrate it." }),
      });
      try {
        const failed = await call(session.client, "switch_design", { name: "brand" });
        expect(failed.isError).toBe(true);
        expect(texts(failed)[0]).toContain("DesignSwitchFailed");
        expect(texts(failed)[0]).toContain("velloo upgrade");
        expect(await screenIds(session.client)).toEqual(["home"]);
      } finally {
        await session.close();
      }
    });

    test("an unknown name lists the designs; a plan refuses to switch mid-way", async () => {
      const session = await agent({ switchTo: async () => ({ error: "unreachable" }) });
      try {
        const unknown = await call(session.client, "switch_design", { name: "nope" });
        expect(unknown.isError).toBe(true);
        expect(JSON.parse(texts(unknown)[0] ?? "{}")).toMatchObject({
          kind: "UnknownDesign",
          designs: ["brand", "web"],
        });

        const plan = await session.client.callTool({
          name: "run_velloo_plan",
          arguments: { calls: [{ operation: "switch_design", arguments: { name: "brand" } }] },
        });
        expect(plan.isError).toBe(true);
        expect(texts(plan).join("\n")).toContain("SwitchDesignInPlan");
      } finally {
        await session.close();
      }
    });
  });
});
