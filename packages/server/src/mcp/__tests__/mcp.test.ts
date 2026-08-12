import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { createMcpServer } from "../server.ts";

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  componentSource: { framework: "shadcn-react", snapshotVersion: "test" },
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
};
const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};
const samplePage: Page = {
  name: "Onboarding",
  variants: [
    {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: {
        $ref: "Card",
        children: [{ $ref: "Heading", props: { level: 1, children: "Welcome" } }],
      },
    },
  ],
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let mcp: { url: string; close(): Promise<void> };
let sessionId: string;
let rpcId = 0;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Extract a JSON-RPC response from either JSON or text/event-stream body. */
function parseRpcResponse(raw: string): { result?: unknown; error?: unknown } {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // SSE: pick the last "data: ..." line.
    const lines = raw.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line?.startsWith("data: ")) {
        return JSON.parse(line.slice("data: ".length));
      }
    }
    throw new Error(`unparseable MCP response: ${raw.slice(0, 200)}`);
  }
}

async function openSession(url: string): Promise<string> {
  const initRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "velloo-test", version: "0.0.0" },
      },
    }),
  });
  const sid = initRes.headers.get("mcp-session-id");
  await initRes.text();
  if (!sid) throw new Error("server did not return mcp-session-id");

  // Complete the handshake with the `initialized` notification.
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sid,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  return sid;
}

async function callTool(
  url: string,
  sid: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content?: { type: string; text: string }[]; isError?: boolean }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sid,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = parseRpcResponse(await res.text()) as {
    result?: { content?: { type: string; text: string }[]; isError?: boolean };
  };
  if (!body.result) throw new Error(`no result: ${JSON.stringify(body)}`);
  return body.result;
}

beforeEach(async () => {
  rpcId = 0;
  tmp = join(tmpdir(), `velloo-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "pages/onboarding.json"), samplePage);
  folder = await loadDesignFolder(tmp);
  ctx = { folder, broadcast: () => {} };
  mcp = await createMcpServer(ctx, { port: 0, host: "127.0.0.1" });
  sessionId = await openSession(mcp.url);
});

afterEach(async () => {
  await mcp.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("MCP server", () => {
  test("list_pages returns the page summary", async () => {
    const r = await callTool(mcp.url, sessionId, "list_pages", {});
    const text = r.content?.[0]?.text ?? "";
    const data = JSON.parse(text) as { pages: { id: string }[] };
    expect(data.pages.map((p) => p.id)).toEqual(["onboarding"]);
  });

  test("get_page returns the full page JSON", async () => {
    const r = await callTool(mcp.url, sessionId, "get_page", { pageId: "onboarding" });
    const data = JSON.parse(r.content?.[0]?.text ?? "{}") as { name: string };
    expect(data.name).toBe("Onboarding");
  });

  test("list_components includes the snapshot", async () => {
    const r = await callTool(mcp.url, sessionId, "list_components", {});
    const data = JSON.parse(r.content?.[0]?.text ?? "[]") as { id: string }[];
    expect(data.map((c) => c.id)).toContain("Button");
  });

  test("update_props edits a node and persists", async () => {
    const r = await callTool(mcp.url, sessionId, "update_props", {
      pageId: "onboarding",
      variantId: "mobile",
      path: [0],
      propPatch: { level: 2 },
    });
    expect(r.isError).toBeFalsy();
    expect(folder.pages.get("onboarding")?.variants[0]?.tree.children?.[0]?.props?.level).toBe(2);
  });

  test("add_node returns the new path", async () => {
    const r = await callTool(mcp.url, sessionId, "add_node", {
      pageId: "onboarding",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Button",
      props: { children: "Go" },
    });
    const data = JSON.parse(r.content?.[0]?.text ?? "{}") as { path: number[] };
    expect(data.path).toEqual([1]);
  });

  test("inspect returns ref + classes + html", async () => {
    const r = await callTool(mcp.url, sessionId, "inspect", {
      pageId: "onboarding",
      variantId: "mobile",
      path: [0],
    });
    const data = JSON.parse(r.content?.[0]?.text ?? "{}") as { ref: string; bodyHtml: string };
    expect(data.ref).toBe("Heading");
    expect(data.bodyHtml).toContain("Welcome");
  });

  test("unknown component returns an MCP error result with suggestions", async () => {
    const r = await callTool(mcp.url, sessionId, "add_node", {
      pageId: "onboarding",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Buttn",
    });
    expect(r.isError).toBe(true);
    const text = r.content?.[0]?.text ?? "";
    const error = JSON.parse(text) as { kind: string; suggestions?: string[] };
    expect(error.kind).toBe("UnknownComponent");
    expect(error.suggestions).toContain("Button");
  });

  test("apply_preset switches the theme and persists", async () => {
    const r = await callTool(mcp.url, sessionId, "apply_preset", { presetName: "rose" });
    expect(r.isError).toBeFalsy();
    expect(folder.theme.name).toBe("rose");
  });

  test("derive_palette_from_color produces a violet theme", async () => {
    const r = await callTool(mcp.url, sessionId, "derive_palette_from_color", {
      seedColor: "#7c3aed",
    });
    const data = JSON.parse(r.content?.[0]?.text ?? "{}") as {
      theme: { colors: { primary: { DEFAULT: string } } };
    };
    expect(data.theme.colors.primary.DEFAULT).toContain("oklch");
  });

  test("match_vibe (heuristic) maps known vibes to seeds", async () => {
    const r = await callTool(mcp.url, sessionId, "match_vibe", { description: "playful" });
    const data = JSON.parse(r.content?.[0]?.text ?? "{}") as {
      matched: { keywords: string[]; source: string };
    };
    expect(data.matched.keywords).toContain("playful");
    expect(data.matched.source).toBe("heuristic");
  });

  test("apply_preset rejects an unknown name", async () => {
    const r = await callTool(mcp.url, sessionId, "apply_preset", { presetName: "neonpunk" });
    expect(r.isError).toBe(true);
    const error = JSON.parse(r.content?.[0]?.text ?? "{}") as { kind: string };
    expect(error.kind).toBe("UnknownPreset");
  });

  test("multiple tool calls reuse the same session", async () => {
    await callTool(mcp.url, sessionId, "list_pages", {});
    await callTool(mcp.url, sessionId, "get_theme", {});
    const r = await callTool(mcp.url, sessionId, "list_pages", {});
    const data = JSON.parse(r.content?.[0]?.text ?? "{}") as { pages: { id: string }[] };
    expect(data.pages).toHaveLength(1);
  });

  test("POST without session and not initialize returns 400", async () => {
    const res = await fetch(mcp.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 999, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
  });
});
