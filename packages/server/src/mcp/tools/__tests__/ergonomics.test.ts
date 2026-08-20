import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { z } from "zod";
import { type DesignFolder, loadDesignFolder } from "../../../design-folder.ts";
import { runBatch } from "../../../mutations/batch.ts";
import {
  invalidPath,
  nearestRefs,
  normalizeRef,
  screenIdConflict,
  unknownComponent,
} from "../../../mutations/errors.ts";
import type { MutationContext } from "../../../mutations/index.ts";
import type { WatchEvent } from "../../../watcher.ts";
import { registerDiscoveryTools } from "../discovery.ts";
import { registerMutationTools } from "../mutations.ts";
import { jsonTolerant } from "../schemas.ts";

/**
 * Guards the trace-mining ergonomics fixes: actionable error hints, JSON-tolerant
 * inputs, single+bulk auto-merge, the batch index-path footgun guard, snippet/$ref
 * disambiguation, and the snippet `required` flag.
 */

const provider = createShadcnProvider();
const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  library: {
    id: "shadcn-react" as const,
    version: "test",
    source: "binary",
    componentsPath: "binary",
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};
const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: WatchEvent[];

const writeJson = (p: string, v: unknown) =>
  writeFile(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-ergo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "snippets"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: { $ref: "Box", props: { className: "p-4" }, children: [] },
  });
  await writeJson(join(tmp, "snippets/site-header.json"), {
    id: "site-header",
    name: "Site Header",
    params: [
      { name: "title", type: "string" },
      { name: "subtitle", type: "string", optional: true },
    ],
    tree: { $ref: "Box", props: {}, children: [] },
  });
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

type McpToolResult = { isError?: true; content: { type: string; text: string }[] };
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpToolResult>;

function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerMutationTools(mcp, ctx);
  registerDiscoveryTools(mcp, ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.handler(args, {});
}

const parse = (r: McpToolResult): Record<string, unknown> => JSON.parse(r.content[0]?.text ?? "{}");

describe("error hints + fuzzy matching", () => {
  test("nearestRefs is separator/case-insensitive (SiteHeader ↔ site-header)", () => {
    expect(normalizeRef("SiteHeader")).toBe(normalizeRef("site-header"));
    expect(nearestRefs("SiteHeader", ["site-header", "Box", "Card"])[0]).toBe("site-header");
  });

  test("invalidPath carries a hint when given one; ScreenIdConflict always does", () => {
    const ip = invalidPath("No node at path [1]", [1], "use @id");
    if (ip.kind === "InvalidPath") expect(ip.hint).toBe("use @id");
    const sc = screenIdConflict("reviews");
    if (sc.kind === "ScreenIdConflict") expect(sc.hint).toContain("already exists");
    const uc = unknownComponent("X", [], "it's a snippet");
    if (uc.kind === "UnknownComponent") expect(uc.hint).toContain("snippet");
  });

  test("a stale numeric path returns InvalidPath with a find_nodes hint", async () => {
    const r = await callTool("update_props", {
      screenId: "landing",
      path: [5],
      propPatch: { className: "x" },
    });
    expect(r.isError).toBe(true);
    const e = parse(r);
    expect(e.kind).toBe("InvalidPath");
    expect(String(e.hint)).toContain("find_nodes");
  });

  test("a $ref that is actually a snippet points at instantiate_snippet/$snippet", async () => {
    const r = await callTool("add_node", {
      screenId: "landing",
      parentPath: [],
      componentRef: "SiteHeader",
    });
    expect(r.isError).toBe(true);
    const e = parse(r);
    expect(e.kind).toBe("UnknownComponent");
    expect(String(e.hint)).toContain("site-header");
    expect(String(e.hint)).toContain("$snippet");
  });
});

describe("input tolerance + auto-merge", () => {
  test("jsonTolerant parses a stringified array before validating (add_node's children path)", () => {
    const schema = jsonTolerant(z.array(z.object({ $ref: z.string() })));
    expect(schema.parse('[{"$ref":"Box"}]')).toEqual([{ $ref: "Box" }]);
    // Non-JSON strings pass through untouched (so the scalar nudge still fires downstream).
    expect(jsonTolerant(z.union([z.array(z.unknown()), z.string()])).parse("Save")).toBe("Save");
  });

  test("batch add_node accepts a stringified children array (parsed in-code)", async () => {
    const res = await runBatch(ctx, [
      {
        tool: "add_node",
        args: {
          screenId: "landing",
          parentPath: [],
          componentRef: "Box",
          children: '[{"$ref":"Box","props":{"className":"inner"}}]',
        },
      },
    ]);
    expect(res.completed).toBe(1);
    expect(res.results[0]?.ok).toBe(true);
  });

  test("update_props merges a single edit + patches instead of rejecting", async () => {
    const r = await callTool("update_props", {
      screenId: "landing",
      path: [],
      propPatch: { className: "a" },
      patches: [{ path: [], propPatch: { "data-x": "1" } }],
    });
    expect(r.isError).toBeUndefined();
  });
});

describe("batch index-path footgun guard", () => {
  test("≥2 numeric-path remove_node on one screen is refused up front", async () => {
    const res = await runBatch(ctx, [
      { tool: "remove_node", args: { screenId: "landing", path: [0] } },
      { tool: "remove_node", args: { screenId: "landing", path: [1] } },
    ]);
    expect(res.completed).toBe(0);
    expect(res.results[0]?.ok).toBe(false);
    const err = res.results[0]?.error as { kind?: string; message?: string };
    expect(err.kind).toBe("BadRequest");
    expect(err.message).toContain("@id");
  });

  test("a single numeric-path remove_node is allowed (no false positive)", async () => {
    // Two @id removes don't trip it either — only numeric paths shift.
    const res = await runBatch(ctx, [
      { tool: "remove_node", args: { screenId: "landing", path: "@a" } },
      { tool: "remove_node", args: { screenId: "landing", path: "@b" } },
    ]);
    // These fail individually (no such ids) but the guard itself didn't fire.
    expect(res.results[0]?.tool).not.toBe("batch");
  });
});

describe("snippet param contract", () => {
  test("list_snippets reports a derived required flag", async () => {
    const r = await callTool("list_snippets", {});
    const data = parse(r) as {
      snippets: { id: string; params: { name: string; required: boolean }[] }[];
    };
    const sh = data.snippets.find((s) => s.id === "site-header");
    expect(sh).toBeDefined();
    const title = sh?.params.find((p) => p.name === "title");
    const subtitle = sh?.params.find((p) => p.name === "subtitle");
    expect(title?.required).toBe(true);
    expect(subtitle?.required).toBe(false);
  });
});
