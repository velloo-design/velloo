import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { repoKey } from "@velloo/schema";
import { registerComposeTool } from "../../mcp/tools/compose.ts";
import { registerEmitTools } from "../../mcp/tools/emit.ts";
import type { McpResult } from "../../mcp/tools/result.ts";
import type { RepoCatalog, RepoCatalogEntry } from "../../repo/catalog.ts";
import { designConfig, type TestContext, testContext } from "../../testing/design-folder.ts";
import { addNode, setScreenTree, updateProps } from "../index.ts";

/**
 * A none/none folder over a Mantine app: emit_code prints the app's `Text` as
 * `<Text size="sm" c="dimmed">`, and pasted back into compose that bare name
 * is Velloo's `Text`, which takes neither. Warnings beside a successful write
 * were ignored, so the write is refused and names `<Mantine.Text>`.
 */

const mantine = (name: string, props: string[]): RepoCatalogEntry =>
  ({
    id: `Mantine.${name}`,
    name,
    key: repoKey({ importPath: "@mantine/core", exportName: name }),
    identity: { importPath: "@mantine/core", exportName: name },
    props: props.map((prop) => ({ name: prop })),
    styleProps: ["style"],
  }) as unknown as RepoCatalogEntry;

let t: TestContext;

beforeEach(async () => {
  t = await testContext({
    provider: createNoneProvider(),
    config: designConfig({
      library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
      styling: { framework: "none" },
    }),
    screens: {
      home: {
        id: "home",
        name: "Home",
        tree: { $ref: "Box", children: [{ $ref: "Text", props: { children: "Hi" } }] },
      },
    },
  });
  const entries = [
    mantine("Text", ["size", "c"]),
    mantine("Card", ["withBorder"]),
    mantine("Box", ["c"]),
  ];
  const catalog = {
    entries,
    byId: new Map(entries.map((e) => [e.id, e])),
    byKey: new Map(entries.map((e) => [e.key, e])),
  } as unknown as RepoCatalog;
  t.ctx.repo = {
    catalog: async () => catalog,
    resolveName: async () => null,
  } as unknown as NonNullable<TestContext["ctx"]["repo"]>;
});
afterEach(() => t.cleanup());

describe("a bare Velloo name given the app's props", () => {
  test("is refused, naming every node and the qualified component", async () => {
    const before = t.ctx.folder.screens.get("home");
    const r = await setScreenTree(t.ctx, {
      screenId: "home",
      tree: {
        $ref: "Box",
        children: [
          { $ref: "Text", $id: "lede", props: { size: "sm", c: "dimmed", children: "x" } },
          { $ref: "Card", props: { withBorder: true } },
        ],
      },
    });
    if (r.ok) throw new Error("expected a refusal");
    if (r.error.kind !== "ShadowedComponent") throw new Error(r.error.kind);
    expect(r.error.nodes).toEqual([
      { at: "@lede", ref: "Text", appComponent: "Mantine.Text", props: ["size", "c"] },
      { at: "root.children.1", ref: "Card", appComponent: "Mantine.Card", props: ["withBorder"] },
    ]);
    expect(r.error.hint).toContain(
      "Write <Mantine.Text> — it takes size, c; Velloo's Text does not.",
    );
    expect(r.error.hint).toContain("Write <Mantine.Card>");
    expect(t.ctx.folder.screens.get("home")).toBe(before);
  });

  test("add_node refuses the node and its subtree in one error", async () => {
    const r = await addNode(t.ctx, {
      screenId: "home",
      parentPath: [],
      componentRef: "Card",
      props: { withBorder: true },
      children: [{ $ref: "Text", props: { c: "dimmed" } }],
    });
    if (r.ok || r.error.kind !== "ShadowedComponent") throw new Error("expected a refusal");
    expect(r.error.nodes.map((n) => n.appComponent)).toEqual(["Mantine.Card", "Mantine.Text"]);
  });

  test("update_props refuses setting the app's prop, not removing it", async () => {
    const set = await updateProps(t.ctx, {
      screenId: "home",
      patches: [{ path: [0], propPatch: { size: "sm" } }],
    });
    if (set.ok || set.error.kind !== "ShadowedComponent") throw new Error("expected a refusal");
    expect(set.error.nodes).toEqual([
      { at: "[0]", ref: "Text", appComponent: "Mantine.Text", props: ["size"] },
    ]);
    const removed = await updateProps(t.ctx, {
      screenId: "home",
      patches: [{ path: [0], propPatch: { size: null } }],
    });
    expect(removed.ok).toBe(true);
  });

  test("Velloo's Text with its own props is written", async () => {
    const r = await addNode(t.ctx, {
      screenId: "home",
      parentPath: [],
      componentRef: "Text",
      props: { variant: "muted", children: "Supporting copy." },
    });
    expect(r.ok).toBe(true);
  });

  test("a plain Box with style and as is written", async () => {
    const r = await addNode(t.ctx, {
      screenId: "home",
      parentPath: [],
      componentRef: "Box",
      props: { as: "section", style: { padding: 24 } },
    });
    expect(r.ok).toBe(true);
  });
});

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

/** compose, registered alone on a throwaway server and called as the façade calls it. */
async function compose(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerComposeTool(mcp, t.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const r = await (tools.compose as { handler: ToolHandler }).handler(args, {});
  const text = r.content[0]?.type === "text" ? r.content[0].text : "{}";
  return { ...(JSON.parse(text) as Record<string, unknown>), isError: r.isError === true };
}

describe("compose given a bare name with the app's props", () => {
  test("writes the app's component when only one takes them, and says which", async () => {
    const r = await compose({
      screenId: "home",
      mode: "replace",
      jsx: `<Box>
        <Text size="sm" c="dimmed">Lede</Text>
        <Text c="red">Alert</Text>
        <Text variant="muted">Velloo's own</Text>
        <Card withBorder><Text>Plain</Text></Card>
      </Box>`,
    });
    expect(r.isError).toBe(false);
    expect((r.appComponents as { read: unknown }).read).toEqual([
      { name: "Text", as: "Mantine.Text", props: ["size", "c"], nodes: 2 },
      { name: "Card", as: "Mantine.Card", props: ["withBorder"], nodes: 1 },
    ]);
    const tree = t.ctx.folder.screens.get("home")?.tree as {
      children: {
        $ref: string;
        $repo?: { importPath: string; exportName: string };
        children?: { $repo?: unknown }[];
      }[];
    };
    const [lede, alert, own, card] = tree.children;
    expect(lede?.$repo).toEqual({ importPath: "@mantine/core", exportName: "Text" });
    expect(alert?.$repo?.importPath).toBe("@mantine/core");
    // Velloo's own props keep Velloo's component, and so does a name with none.
    expect(own?.$repo).toBeUndefined();
    expect(card?.$repo?.importPath).toBe("@mantine/core");
    expect(card?.children?.[0]?.$repo).toBeUndefined();
  });

  test("still refuses when two app components of that name take the props", async () => {
    const catalog = await t.ctx.repo?.catalog();
    const own = {
      id: "App.Text",
      name: "Text",
      key: repoKey({ importPath: "@/components/text", exportName: "Text" }),
      identity: { importPath: "@/components/text", exportName: "Text" },
      props: [{ name: "c" }],
      styleProps: [],
    } as unknown as RepoCatalogEntry;
    (catalog as { entries: RepoCatalogEntry[] }).entries.push(own);
    const before = t.ctx.folder.screens.get("home");
    const r = await compose({
      screenId: "home",
      mode: "replace",
      jsx: `<Box><Text c="dimmed">Which one?</Text></Box>`,
    });
    expect(r.isError).toBe(true);
    expect(r.kind).toBe("ShadowedComponent");
    expect(t.ctx.folder.screens.get("home")).toBe(before);
  });

  test("an appended node is read the same way", async () => {
    const r = await compose({
      screenId: "home",
      mode: "append",
      jsx: `<Text size="sm">Appended</Text>`,
    });
    expect(r.isError).toBe(false);
    expect((r.appComponents as { read: { as: string }[] }).read[0]?.as).toBe("Mantine.Text");
    const tree = t.ctx.folder.screens.get("home")?.tree as { children: { $repo?: unknown }[] };
    expect(tree.children.at(-1)?.$repo).toEqual({
      importPath: "@mantine/core",
      exportName: "Text",
    });
  });
});

describe("emit_code over the app's shadowing components", () => {
  test("says its JSX is app code, not compose input", async () => {
    const written = await setScreenTree(t.ctx, {
      screenId: "home",
      tree: {
        $ref: "Box",
        children: [
          {
            $ref: "Text",
            $repo: { importPath: "@mantine/core", exportName: "Text" },
            props: { size: "sm", children: "x" },
          },
        ],
      },
    });
    expect(written.ok).toBe(true);
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerEmitTools(mcp, t.ctx);
    const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
      ._registeredTools;
    const r = await (tools.emit_code as { handler: ToolHandler }).handler({ screenId: "home" }, {});
    // The JSON block points at the code, which is the block after it.
    const [meta, code] = r.content.map((part) => (part.type === "text" ? part.text : ""));
    const ir = { ...JSON.parse(meta ?? "{}"), jsx: code } as { jsx: string; warnings: string[] };
    expect(ir.jsx).toContain('<Text size="sm">');
    expect(ir.warnings[0]).toContain("app code, not compose input");
    expect(ir.warnings[0]).toContain("<Mantine.Text>");
  });
});
