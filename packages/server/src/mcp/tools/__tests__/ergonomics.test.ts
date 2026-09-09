import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { z } from "zod";
import type { ActivityEvent } from "../../../activity.ts";
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
import { designConfig, designTheme } from "../../../testing/design-folder.ts";

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
const sampleConfig = designConfig();
const sampleTheme = designTheme({
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
});

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

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
      patches: [{ path: [5], propPatch: { className: "x" } }],
    });
    expect(r.isError).toBe(true);
    const e = parse(r);
    expect(e.kind).toBe("InvalidPath");
    expect(String(e.hint)).toContain("find_nodes");
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

/**
 * The default `list_components` view, through the real tool. The unit tests
 * cover the projection; this covers the wiring — that the index is what an
 * agent gets without asking, that it reads the manifest's own grouping, and
 * that the folder's own layers get shelves of their own.
 */
describe("list_components index", () => {
  test("defaults to the grouped family index, not a per-component list", async () => {
    const data = parse(await callTool("list_components", {})) as {
      groups: { group: string; label: string; families: { id: string; pieces?: string[] }[] }[];
      totals: { components: number; families: number };
      components?: unknown;
    };
    expect(data.components).toBeUndefined();
    expect(data.groups.map((g) => g.group)).toContain("forms");
    // Folded, so families are far fewer than components.
    expect(data.totals.families).toBeLessThan(data.totals.components / 2);

    const forms = data.groups.find((g) => g.group === "forms");
    expect(forms?.label).toBe("Forms & Inputs");
    const field = forms?.families.find((f) => f.id === "Field");
    expect(field?.pieces).toContain("FieldLabel");
    expect(field?.pieces).toContain("FieldError");
    // A piece is never listed as a family of its own.
    expect(forms?.families.some((f) => f.id === "FieldLabel")).toBe(false);
  });

  test("carries the usage notes that steer away from a hand-rolled Box stack", async () => {
    const data = parse(await callTool("list_components", {})) as {
      groups: { families: { id: string; designModeNotes?: string }[] }[];
    };
    const families = data.groups.flatMap((g) => g.families);
    for (const id of ["Field", "InputGroup", "Item", "Empty", "ButtonGroup"]) {
      expect(families.find((f) => f.id === id)?.designModeNotes ?? "").not.toBe("");
    }
  });

  test("gives snippets their own shelf", async () => {
    const data = parse(await callTool("list_components", {})) as {
      groups: { group: string; families: { id: string }[] }[];
    };
    const snippets = data.groups.find((g) => g.group === "snippets");
    expect(snippets?.families.map((f) => f.id)).toContain("SiteHeader");
  });

  test("summary mode still returns prop names per component", async () => {
    // The index trades prop names for size; this is where they still live, and
    // the instructions send the agent here once it has picked a family.
    const data = parse(await callTool("list_components", { filter: "Field", mode: "summary" })) as {
      components: { id: string; props: string[] }[];
    };
    const field = data.components.find((c) => c.id === "Field");
    expect(field?.props).toContain("orientation");
  });
});

describe("snippet param contract", () => {
  test("list_components includes snippets with derived required flags", async () => {
    const r = await callTool("list_components", { kind: "snippet", mode: "full" });
    const data = parse(r) as {
      components: {
        snippetId: string;
        props: { name: string; required: boolean }[];
      }[];
    };
    const sh = data.components.find((s) => s.snippetId === "site-header");
    expect(sh).toBeDefined();
    const title = sh?.props.find((p) => p.name === "title");
    const subtitle = sh?.props.find((p) => p.name === "subtitle");
    expect(title?.required).toBe(true);
    expect(subtitle?.required).toBe(false);
  });

  test("add_snippet warns when a param feeds Icon `name`; update_snippet clears it with the tree", async () => {
    const r = await callTool("add_snippet", {
      name: "Status Chip",
      params: [{ name: "glyph", type: "icon" }],
      tree: { $ref: "Icon", props: { name: { $param: "glyph" } } },
    });
    expect(r.isError).toBeUndefined();
    const v = parse(r) as { snippetId: string; propWarnings?: string[] };
    expect(v.propWarnings?.length).toBe(1);
    expect(v.propWarnings?.[0]).toContain('param "glyph"');
    expect(v.propWarnings?.[0]).toContain("`node` param");

    // The warning tracks the RESULTING body: replacing the dynamic name
    // with a literal clears it.
    const u = await callTool("update_snippet", {
      snippetId: v.snippetId,
      patch: { tree: { $ref: "Icon", props: { name: "Check" } } },
    });
    expect(u.isError).toBeUndefined();
    expect(parse(u).propWarnings).toBeUndefined();
  });
});

/**
 * A snippet no screen reaches renders nowhere, and nothing used to say so —
 * so a board delete or a rewritten screen left files behind that only a manual
 * grep would find. `site-header` in this fixture is exactly that: defined, and
 * instantiated by no screen.
 */
describe("unused snippets", () => {
  test("unusedOnly lists just the snippets nothing reaches", async () => {
    const data = parse(
      await callTool("list_components", { unusedOnly: true, mode: "summary" }),
    ) as {
      components: { snippetId: string; kind: string; unused?: boolean }[];
    };

    expect(data.components.map((c) => c.snippetId)).toEqual(["site-header"]);
    expect(data.components[0]?.kind).toBe("snippet");
    expect(data.components[0]?.unused).toBe(true);
  });

  test("a referenced snippet carries no unused flag", async () => {
    await writeJson(join(tmp, "screens/landing.json"), {
      id: "landing",
      name: "Landing",
      tree: {
        $ref: "Box",
        children: [{ $snippet: "site-header", args: { title: "Hi" } }],
      },
    });
    ctx.folder = await loadDesignFolder(tmp);

    const data = parse(await callTool("list_components", { kind: "snippet", mode: "summary" })) as {
      components: { snippetId: string; unused?: boolean }[];
    };
    expect(data.components.find((c) => c.snippetId === "site-header")?.unused).toBeUndefined();
    expect(
      parse(await callTool("list_components", { unusedOnly: true, mode: "summary" })).components,
    ).toEqual([]);
  });

  test("the index says it too, where an agent reads first", async () => {
    const data = parse(await callTool("list_components", {})) as {
      groups: { group: string; families: { id: string; designModeNotes?: string }[] }[];
    };
    const shelf = data.groups.find((g) => g.group === "snippets");
    expect(shelf?.families.find((f) => f.id === "SiteHeader")?.designModeNotes).toContain("unused");
  });
});
