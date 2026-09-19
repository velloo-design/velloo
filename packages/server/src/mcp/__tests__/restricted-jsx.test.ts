import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isComponentNode, isSnippetInstance, type Snippet } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { loadDesignFolder } from "../../design-folder.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { compileRestrictedJsx } from "../restricted-jsx.ts";
import { registerComposeTool } from "../tools/compose.ts";

let tmp: string;
let ctx: MutationContext;

beforeAll(async () => {
  tmp = join(tmpdir(), `velloo-jsx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  const writeJson = (path: string, value: unknown) =>
    writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeJson(join(tmp, ".design/config.json"), {
    schemaVersion: 4,
    name: "test",
    toolVersion: "0.1.0",
    libraries: {
      default: {
        id: "shadcn-upstream",
        version: "test",
        source: "binary",
        componentsPath: "binary",
      },
    },
    defaultLibrary: "default",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
  });
  await writeJson(join(tmp, "theme/default.json"), {
    name: "default",
    colors: {
      background: "#fff",
      foreground: "#000",
      primary: { DEFAULT: "#000", foreground: "#fff" },
    },
    typography: {},
    spacing: {},
    radius: {},
  });
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: { $ref: "Box", props: {}, children: [] },
  });
  const provider = createShadcnProvider();
  const folder = await loadDesignFolder(tmp);
  const snippet: Snippet = {
    id: "feature-card",
    name: "Feature Card",
    params: [
      { name: "title", type: "string" },
      { name: "children", type: "node", optional: true },
    ],
    tree: { $ref: "Card", props: {}, children: [] },
  };
  folder.snippets.set(snippet.id, snippet);
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => {},
  };
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("restricted JSX compiler", () => {
  test("compiles familiar nested JSX, JSON props, text, and stable ids", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<Card vellooId="hero" className="p-6" style={{"opacity":0.8}}><Heading level={2}>Hello world</Heading></Card>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node).toMatchObject({
      $ref: "Card",
      $id: "hero",
      props: { className: "p-6", style: { opacity: 0.8 } },
      children: [{ $ref: "Heading", props: { level: 2, children: "Hello world" } }],
    });
  });

  test("resolves snippets through the same PascalCase tag namespace", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<FeatureCard title="Fast" className="ring-1"><Button>Go</Button></FeatureCard>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isSnippetInstance(result.node)) return;
    expect(result.node).toMatchObject({
      $snippet: "feature-card",
      $extraClassName: "ring-1",
      args: { title: "Fast", children: { $ref: "Button", props: { children: "Go" } } },
    });
  });

  test("an element passed as a prop compiles to a node-valued prop", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<Button icon={ <Icon name="bolt" /> } badge={<FeatureCard title="New" />}>Go</Button>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.props).toMatchObject({
      icon: { $ref: "Icon", props: { name: "bolt" } },
      badge: { $snippet: "feature-card", args: { title: "New" } },
      children: "Go",
    });
    // A literal node is held to the same namespace as a tag.
    const literal = await compileRestrictedJsx(
      ctx,
      screen,
      '<Button icon={{"$ref": "Iconn"}}>Go</Button>',
    );
    expect(literal.ok).toBe(false);
    if (!literal.ok) expect(literal.issues[0]?.message).toContain("in a prop value");
    // Still data only: an element's own props are held to the same rules.
    const executable = await compileRestrictedJsx(
      ctx,
      screen,
      "<Button icon={<Icon onClick={() => x()} />}>Go</Button>",
    );
    expect(executable.ok).toBe(false);
  });

  test("never executes expressions and locates the error", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      "<Box>\n  <Button onClick={() => dangerous()}>Go</Button>\n</Box>",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ line: 2, column: expect.any(Number) });
    expect(result.issues[0]?.message).toContain("JSON literals");
  });

  test("accepts JSX-style data objects without executing JavaScript", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      "<Card style={{ opacity: 0.8, padding: '12px', nested: { display: 'grid', }, }} />",
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.props?.style).toEqual({
      opacity: 0.8,
      padding: "12px",
      nested: { display: "grid" },
    });

    const executable = await compileRestrictedJsx(
      ctx,
      screen,
      "<Card style={{ color: token() }} />",
    );
    expect(executable.ok).toBe(false);
  });

  test("unknown tags return nearby component names", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(ctx, screen, "<Buton />");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ line: 1, column: 1 });
    expect(result.issues[0]?.message).toContain("Button");
  });

  test("compose replaces a root and appends a subtree through one tool", async () => {
    type Handler = (args: Record<string, unknown>) => Promise<{
      isError?: true;
      content: { type: "text"; text: string }[];
    }>;
    let handler: Handler | undefined;
    const mcp = {
      registerTool: (name: string, _config: unknown, cb: Handler) => {
        if (name === "compose") handler = cb;
      },
    } as unknown as McpServer;
    registerComposeTool(mcp, ctx);
    if (!handler) throw new Error("compose was not registered");

    const replace = await handler({
      screenId: "landing",
      mode: "replace",
      jsx: '<Card vellooId="shell"><Heading>Replaced</Heading></Card>',
    });
    expect(replace.isError).toBeUndefined();
    expect(ctx.folder.screens.get("landing")?.tree).toMatchObject({ $ref: "Card", $id: "shell" });

    const append = await handler({
      screenId: "landing",
      mode: "append",
      parentPath: "@shell",
      jsx: "<Button>Continue</Button>",
    });
    expect(append.isError).toBeUndefined();
    expect(ctx.folder.screens.get("landing")?.tree).toMatchObject({
      children: [{ $ref: "Heading" }, { $ref: "Button", props: { children: "Continue" } }],
    });
  });

  test("text beside an element is wrapped rather than rejected", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    // The icon button, written the way every library writes it.
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<Button><Icon name="gift" />Rewards</Button>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node).toMatchObject({
      $ref: "Button",
      children: [{ $ref: "Icon" }, { $ref: "Text", props: { children: "Rewards" } }],
    });
    // No `children` prop: the text lives in the wrapper, not in both places.
    expect(result.node.props?.children).toBeUndefined();
  });

  test("wrapping preserves source order and drops formatting whitespace", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      "<Box>Total\n  <Badge>3</Badge>\n  items</Box>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.children).toMatchObject([
      { $ref: "Text", props: { children: "Total" } },
      { $ref: "Badge", props: { children: "3" } },
      { $ref: "Text", props: { children: "items" } },
    ]);
  });

  test("text alone still becomes a children prop, not a wrapper", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(ctx, screen, "<Button>Save</Button>");
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node).toMatchObject({ $ref: "Button", props: { children: "Save" } });
    expect(result.node.children).toBeUndefined();
  });
});
