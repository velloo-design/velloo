import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { repoKey, type Snippet, type SnippetInstance } from "@velloo/schema";
import { registerRenderSnippetTool } from "../../mcp/tools/render-snippet.ts";
import type { McpResult } from "../../mcp/tools/result.ts";
import { pathAt } from "../../path.ts";
import type { RepoCatalog, RepoCatalogEntry } from "../../repo/catalog.ts";
import { designScreen, type TestContext, testContext } from "../../testing/design-folder.ts";
import { instantiateSnippet, updateSnippetArgs } from "../index.ts";

/**
 * A snippet's args are stored opaque, so a node passed as one used to reach the
 * renderer as written: the app's `ReviewCard` by its bare name was a component
 * Velloo's library doesn't have, and `children: ["Review card"]` a string where
 * a node goes. Both failed only when the screen or preview rendered, as the
 * whole render — the first render_snippet call of two eval runs in three.
 */

const reviewCard = {
  id: "ReviewCard",
  name: "ReviewCard",
  key: repoKey({ importPath: "@/components/review-card", exportName: "ReviewCard" }),
  identity: { importPath: "@/components/review-card", exportName: "ReviewCard" },
  props: [{ name: "review" }],
  styleProps: [],
} as unknown as RepoCatalogEntry;

const slot: Snippet = {
  id: "review-entry",
  name: "Review Entry",
  params: [
    { name: "card", type: "node" },
    { name: "label", type: "string", optional: true },
  ],
  tree: { $ref: "Box", props: { className: "contents" }, children: [{ $param: "card" }] },
};

let t: TestContext;

beforeEach(async () => {
  t = await testContext({
    label: "snippet-args",
    screens: { home: designScreen("home", { tree: { $ref: "Box", children: [] } }) },
    snippets: { "review-entry": slot },
  });
  const catalog = {
    entries: [reviewCard],
    byId: new Map([[reviewCard.id, reviewCard]]),
    byKey: new Map([[reviewCard.key, reviewCard]]),
  } as unknown as RepoCatalog;
  t.ctx.repo = {
    catalog: async () => catalog,
    resolveName: async () => null,
  } as unknown as NonNullable<TestContext["ctx"]["repo"]>;
});
afterEach(() => t.cleanup());

async function place(args: Record<string, unknown>) {
  const r = await instantiateSnippet(t.ctx, {
    screenId: "home",
    parentPath: [],
    snippetId: "review-entry",
    args,
  });
  if (!r.ok) return r;
  const tree = t.ctx.folder.screens.get("home")?.tree;
  const node = tree ? (pathAt(tree, r.value.path) as SnippetInstance) : null;
  return { ok: true as const, args: node?.args ?? {} };
}

describe("a node arg", () => {
  test("naming the app's component by its bare name is that component", async () => {
    const r = await place({ card: { $ref: "ReviewCard", props: { review: { id: "r2" } } } });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.args.card).toEqual({
      $ref: "ReviewCard",
      $repo: { importPath: "@/components/review-card", exportName: "ReviewCard" },
      props: { review: { id: "r2" } },
    });
  });

  test("holding a string child holds text, as a child anywhere else does", async () => {
    const r = await place({
      card: { $ref: "Box", props: { className: "p-4" }, children: ["Review card"] },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.args.card).toMatchObject({ children: [{ $text: "Review card" }] });
  });

  test("given as a string or a list is text, or several nodes", async () => {
    const text = await place({ card: "Just a line" });
    if (!text.ok) throw new Error(JSON.stringify(text.error));
    expect(text.args.card).toEqual({ $text: "Just a line" });

    const list = await place({ card: [{ $ref: "Badge" }, "and more"] });
    if (!list.ok) throw new Error(JSON.stringify(list.error));
    expect(list.args.card).toEqual([{ $ref: "Badge" }, { $text: "and more" }]);
  });

  test("that is no node is refused, naming the param, before anything is written", async () => {
    const before = t.ctx.folder.screens.get("home");
    const r = await place({ card: { text: "Review card" } });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.error).toMatchObject({ kind: "SnippetParamMismatch", snippetId: "review-entry" });
    expect((r.error as { reason: string }).reason).toContain('"card" is a node param');
    expect(t.ctx.folder.screens.get("home")).toBe(before);
  });

  test("with a child that is no node says what a node is, and where", async () => {
    const r = await place({ card: { $ref: "Box", children: [{ text: "Review card" }] } });
    if (r.ok) throw new Error("expected a refusal");
    const reason = (r.error as { reason: string }).reason;
    expect(reason).toContain('"$text" (text beside elements)');
    expect(reason).toContain("(at children.0)");
  });

  test("naming a component nothing knows is refused where it is written", async () => {
    const r = await place({ card: { $ref: "NoSuchCard" } });
    expect(r.ok).toBe(false);
  });

  test("leaves a $if branch and the other params as written", async () => {
    const branch = { $if: "label", then: { $ref: "Badge" } };
    const r = await place({ card: branch, label: "New" });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.args).toEqual({ card: branch, label: "New" });
  });
});

describe("update_snippet_args", () => {
  test("reads a node arg the way placing the snippet does, and still clears with null", async () => {
    const placed = await instantiateSnippet(t.ctx, {
      screenId: "home",
      parentPath: [],
      snippetId: "review-entry",
      args: { card: { $ref: "Badge" }, label: "Old" },
    });
    if (!placed.ok) throw new Error(JSON.stringify(placed.error));
    const r = await updateSnippetArgs(t.ctx, {
      screenId: "home",
      path: placed.value.path,
      argPatch: { card: { $ref: "ReviewCard" }, label: null },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const tree = t.ctx.folder.screens.get("home")?.tree;
    const node = tree ? (pathAt(tree, r.value.path) as SnippetInstance) : null;
    expect(node?.args).toEqual({
      card: {
        $ref: "ReviewCard",
        $repo: { importPath: "@/components/review-card", exportName: "ReviewCard" },
      },
    });
  });
});

describe("render_snippet", () => {
  test("refuses an arg placing the snippet would refuse, before it renders anything", async () => {
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const unused = <T>(): T => ({}) as T;
    registerRenderSnippetTool(mcp, t.ctx, unused(), unused(), unused());
    const tool = (
      mcp as unknown as {
        _registeredTools: Record<
          string,
          { handler: (a: unknown, e: unknown) => Promise<McpResult> }
        >;
      }
    )._registeredTools.render_snippet;
    const result = await tool?.handler(
      { snippetId: "review-entry", args: { card: { text: "Review card" } } },
      {},
    );
    expect(result?.isError).toBe(true);
    const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
    expect(JSON.parse(text)).toMatchObject({ kind: "SnippetParamMismatch" });
  });
});
