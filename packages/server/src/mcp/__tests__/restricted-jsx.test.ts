import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { emitCode } from "@velloo/codegen";
import type { ComponentProvider, CssFramework, FrameworkAdapter } from "@velloo/provider";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { unwrap } from "@velloo/result";
import {
  isComponentNode,
  isSnippetInstance,
  type Library,
  LibrarySchema,
  type Node,
  type Snippet,
} from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { loadDesignFolder } from "../../design-folder.ts";
import { emitFrameworkContextFor } from "../../emit-context.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { resolveProviders } from "../../providers.ts";
import { designConfig, designScreen, testContext } from "../../testing/design-folder.ts";
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

  test("a string `style` is the screen's class list, as update_props takes it", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<Box className="p-6" style="flex gap-4"><Text>Hi</Text></Box>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.props).toEqual({ className: "p-6 flex gap-4" });
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
    // A polymorphic prop names the one thing a design can't hold; say which.
    const polymorphic = await compileRestrictedJsx(
      ctx,
      screen,
      "<Box component={ScrollArea}>Go</Box>",
    );
    expect(polymorphic.ok).toBe(false);
    if (!polymorphic.ok) {
      expect(polymorphic.issues[0]?.message).toContain("is a component type");
    }
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
    // The result names the element it went into, so a wrong parent shows.
    expect(JSON.parse(append.content[0]?.text ?? "{}").into).toBe("<Card>");

    // A fragment appends each root as a sibling, in order, at the index given.
    const rows = await handler({
      screenId: "landing",
      mode: "append",
      parentPath: "@shell",
      index: 1,
      jsx: '<><Badge vellooId="a">A</Badge><Badge vellooId="b">B</Badge></>',
    });
    expect(rows.isError).toBeUndefined();
    const body = JSON.parse(rows.content[0]?.text ?? "{}") as {
      added?: unknown[];
      roots?: unknown[];
    };
    expect(body.added).toHaveLength(2);
    expect(body.roots).toHaveLength(2);
    expect(ctx.folder.screens.get("landing")?.tree).toMatchObject({
      children: [{ $ref: "Heading" }, { $id: "a" }, { $id: "b" }, { $ref: "Button" }],
    });

    // Bare siblings append the same way; agents leave the fragment off.
    const bare = await handler({
      screenId: "landing",
      mode: "append",
      parentPath: "@shell",
      jsx: '<Badge vellooId="c">C</Badge>\n<Badge vellooId="d">D</Badge>',
    });
    expect(bare.isError).toBeUndefined();
    expect(ctx.folder.screens.get("landing")?.tree).toMatchObject({
      children: [
        { $ref: "Heading" },
        { $id: "a" },
        { $id: "b" },
        { $ref: "Button" },
        { $id: "c" },
        { $id: "d" },
      ],
    });

    // Replace still takes exactly one root.
    for (const jsx of ["<><Card /><Card /></>", "<Card /><Card />"]) {
      const twoRoots = await handler({ screenId: "landing", mode: "replace", jsx });
      expect(twoRoots.isError).toBe(true);
    }
  });

  test("a lowercase tag is an HTML element, rendered through Box", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<Box><input placeholder="Search" className="h-8" /><span>Hi</span></Box>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.children).toMatchObject([
      { $ref: "Box", props: { as: "input", placeholder: "Search", className: "h-8" } },
      { $ref: "Box", props: { as: "span", children: "Hi" } },
    ]);
  });

  test("a server-rendered app's lowercase tags become its Html element", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const html = createHtmlProvider();
    const htmlCtx = { ...ctx, providers: { default: html }, defaultProvider: html };
    const result = await compileRestrictedJsx(
      htmlCtx,
      screen,
      '<div className="row"><input name="q" hx-get="search" />Found <b>3</b></div>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node).toMatchObject({
      $ref: "Html",
      props: { as: "div", className: "row" },
      children: [
        { $ref: "Html", props: { as: "input", name: "q", "hx-get": "search" } },
        { $ref: "Html", props: { as: "span", children: "Found " } },
        { $ref: "Html", props: { as: "b", children: "3" } },
      ],
    });
  });

  test("CSS declaration text is a style object on an inline-style channel", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const html = createHtmlProvider();
    const htmlCtx = { ...ctx, providers: { default: html }, defaultProvider: html };
    const result = await compileRestrictedJsx(
      htmlCtx,
      screen,
      '<div style="background: url(data:image/png;base64,AA==) no-repeat; background-size: cover; --gap: 4px; -webkit-line-clamp: 2" />',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.props?.style).toEqual({
      background: "url(data:image/png;base64,AA==) no-repeat",
      backgroundSize: "cover",
      "--gap": "4px",
      WebkitLineClamp: "2",
    });
    const classes = await compileRestrictedJsx(htmlCtx, screen, '<div style="flex gap-4" />');
    expect(classes.ok).toBe(false);
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
      // An inline span that inherits the button's color and size — a `Text`
      // would be a body-colored paragraph, dark on the primary fill.
      children: [{ $ref: "Icon" }, { $ref: "Box", props: { as: "span", children: "Rewards" } }],
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
      { $ref: "Box", props: { as: "span", children: "Total" } },
      { $ref: "Badge", props: { children: "3" } },
      { $ref: "Box", props: { as: "span", children: "items" } },
    ]);
  });

  test("text beside inline elements keeps the spaces JSX keeps", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      "<Box>Move <Badge>GN-48821</Badge> off\n  berth 4\n  <Badge>now</Badge>\n</Box>",
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    // Spaces on a line are content; a line break and its indent are layout.
    expect(result.node.children).toMatchObject([
      { $ref: "Box", props: { as: "span", children: "Move " } },
      { $ref: "Badge", props: { children: "GN-48821" } },
      { $ref: "Box", props: { as: "span", children: " off berth 4" } },
      { $ref: "Badge", props: { children: "now" } },
    ]);
  });

  test("child comments and literals pasted from app source are content, not code", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<Box>\n  {/* Hero */}\n  <Button>Book{" "}now</Button>\n  <Badge>{`Top`} {42}</Badge>\n</Box>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.children).toHaveLength(2);
    expect(result.node.children?.[0]).toMatchObject({ props: { children: "Book now" } });
    expect(result.node.children?.[1]).toMatchObject({ props: { children: "Top 42" } });

    for (const logic of ["{items.map((i) => i)}", "{open && 'x'}", "{`$" + "{name}`}"]) {
      const refused = await compileRestrictedJsx(ctx, screen, `<Box>${logic}</Box>`);
      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      expect(refused.issues[0]?.message).toContain("child expressions are not supported");
    }
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

describe("when the app's component catalog cannot be read", () => {
  const withBrokenRepo = () =>
    ({
      ...ctx,
      repo: {
        catalog: () => Promise.reject(new Error("bundler busy")),
        resolveName: () => Promise.resolve(null),
        host: () => undefined,
        preview: () => undefined,
        recipes: () => [],
      },
    }) as never;

  test("refuses a tag only the catalog could have resolved", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(withBrokenRepo(), screen, "<CountChip />");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain("component catalog could not be read");
    expect(result.issues[0]?.message).toContain("bundler busy");
    expect(result.issues[0]?.message).toContain("<CountChip>");
    expect(result.issues[0]?.message).toContain("Nothing was written");
  });

  test("still compiles a tree of provider and helper tags", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      withBrokenRepo(),
      screen,
      "<Card><Text>ok</Text></Card>",
    );
    expect(result.ok).toBe(true);
  });

  test("a folder with no repo at all still compiles normally", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const noRepo = { ...ctx, repo: undefined } as never;
    const result = await compileRestrictedJsx(noRepo, screen, "<Card><Text>ok</Text></Card>");
    expect(result.ok).toBe(true);
  });
});

describe("a string style on the app's own components", () => {
  const entry = (name: string, styleProps: string[]) => ({
    id: name,
    name,
    identity: { importPath: `@/components/ui/${name.toLowerCase()}`, exportName: name },
    styleProps,
  });
  const withRepo = () =>
    ({
      ...ctx,
      repo: {
        catalog: () => {
          const entries = [entry("AppAvatar", ["className"]), entry("MantineChip", ["style"])];
          return Promise.resolve({ entries, byId: new Map(entries.map((e) => [e.id, e])) });
        },
        resolveName: () => Promise.resolve(null),
        host: () => undefined,
        preview: () => undefined,
        recipes: () => [],
      },
    }) as never;

  test("is the class list on one that styles through className", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(withRepo(), screen, '<AppAvatar style="size-5" />');
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.props).toEqual({ className: "size-5" });
  });

  test("is left for one that declares a style prop of its own", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(withRepo(), screen, '<MantineChip style="x" />');
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.props).toEqual({ style: "x" });
  });
});

/** A real folder for one library, its providers resolved the way the daemon resolves them. */
async function libraryContext(
  id: Library["id"],
  framework?: CssFramework,
): Promise<{ ctx: MutationContext; provider: ComponentProvider; cleanup: () => Promise<void> }> {
  const scaffold = await testContext({
    label: `jsx-${id}`,
    config: designConfig({ library: { id }, ...(framework ? { styling: { framework } } : {}) }),
  });
  const { providers, defaultProvider } = await resolveProviders(
    scaffold.folder.config,
    scaffold.folder.root,
  );
  return {
    ctx: { ...scaffold.ctx, providers, defaultProvider },
    provider: defaultProvider,
    cleanup: scaffold.cleanup,
  };
}

const MARKUP = '<div style="display: flex; gap: 8px"><span>Hi</span>Total <b>3</b></div>';

describe("lowercase HTML and mixed text on an antd screen", () => {
  // antd has no plain element of its own, so its registry once had nothing for
  // `<div>` to become and nothing to wrap stray text in — both compose shapes
  // failed with advice naming components the folder doesn't have.
  test("compose to Box and emit as bare inline-styled elements", async () => {
    const { ctx: antd, cleanup } = await libraryContext("antd");
    try {
      const screen = designScreen("home");
      const result = await compileRestrictedJsx(antd, screen, MARKUP);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.node).toMatchObject({
        $ref: "Box",
        props: { as: "div", style: { display: "flex", gap: "8px" } },
        children: [
          { $ref: "Box", props: { as: "span", children: "Hi" } },
          { $ref: "Box", props: { as: "span", children: "Total " } },
          { $ref: "Box", props: { as: "b", children: "3" } },
        ],
      });

      const emitted = { ...screen, tree: result.node };
      const context = await emitFrameworkContextFor(emitted, antd.providers, antd.defaultProvider);
      const code = unwrap(await emitCode(emitted, context.emit));
      expect(code.jsx).toContain('<div style={{ display: "flex", gap: "8px" }}>');
      expect(code.jsx).toContain("<span>Hi</span>");
      expect(code.jsx).toContain("<b>3</b>");
      expect(code.jsx).not.toContain("Box");
      expect(code.helpersToMaterialize).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  test("a library with no element component says so, and names its own text", async () => {
    const { ctx: antd, provider, cleanup } = await libraryContext("antd");
    try {
      const { Box: _box, ...registry } = provider.registry;
      const bare = { ...provider, registry };
      const stripped = { ...antd, providers: { default: bare }, defaultProvider: bare };
      const screen = designScreen("home");

      const div = await compileRestrictedJsx(stripped, screen, "<div />");
      if (div.ok) throw new Error("expected <div> to be refused");
      expect(div.issues[0]?.message).toContain("<div> is an HTML element");
      expect(div.issues[0]?.message).toContain("this screen's library has no Box");

      const mixed = await compileRestrictedJsx(
        stripped,
        screen,
        '<Button><Icon name="gift" />Rewards</Button>',
      );
      if (mixed.ok) throw new Error("expected mixed text to be refused");
      expect(mixed.issues[0]?.message).toContain("Wrap it in TypographyText");
      expect(mixed.issues[0]?.message).not.toContain("Text or Box");
    } finally {
      await cleanup();
    }
  });
});

/**
 * The compose tool promises lowercase HTML on every screen, and wraps text
 * written beside an element through the same element component — so every
 * library has to register one. Iterating the schema's own id list means a new
 * provider is held to it the day it is added.
 */
describe("every library can lower lowercase HTML and wrap mixed text", () => {
  const pairings: { id: Library["id"]; framework?: CssFramework }[] = [
    ...LibrarySchema.shape.id.options.map((id) => ({ id })),
    { id: "none", framework: "none" },
  ];
  for (const { id, framework } of pairings) {
    test(`${id}${framework ? `/${framework}` : ""}`, async () => {
      const { ctx: library, provider, cleanup } = await libraryContext(id, framework);
      try {
        const element = (provider as FrameworkAdapter).elementComponent ?? "Box";
        const result = await compileRestrictedJsx(library, designScreen("home"), MARKUP);
        if (!result.ok) throw new Error(JSON.stringify(result.issues));
        const refs: unknown[] = [];
        const walk = (node: Node): void => {
          if (!isComponentNode(node)) return;
          refs.push([node.$ref, node.props?.as]);
          for (const child of node.children ?? []) walk(child);
        };
        walk(result.node);
        expect(refs).toEqual([
          [element, "div"],
          [element, "span"],
          [element, "span"],
          [element, "b"],
        ]);
      } finally {
        await cleanup();
      }
    });
  }
});
