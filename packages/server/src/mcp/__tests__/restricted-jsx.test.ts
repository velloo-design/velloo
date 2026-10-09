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
  isTextNode,
  type Library,
  LibrarySchema,
  type Node,
  type Snippet,
} from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { loadDesignFolder } from "../../design-folder.ts";
import { emitFrameworkContextFor } from "../../emit-context.ts";
import { createFrameFitter } from "../../frame-fit.ts";
import { type MutationContext, updateFrames } from "../../mutations/index.ts";
import { resolveProviders } from "../../providers.ts";
import { designConfig, designScreen, testContext } from "../../testing/design-folder.ts";
import { printJsx } from "../jsx-print.ts";
import { compileRestrictedJsx } from "../restricted-jsx.ts";
import { registerComposeTool } from "../tools/compose.ts";
import { registerDiscoveryTools } from "../tools/discovery.ts";

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
      "<Button icon={<Icon name={load()} />}>Go</Button>",
    );
    expect(executable.ok).toBe(false);
  });

  test("never executes expressions and locates the error", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      "<Box>\n  <Button label={dangerous()}>Go</Button>\n</Box>",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ line: 2, column: 18 });
    expect(result.issues[0]?.message).toContain("`dangerous` is not defined");
  });

  test("a handler is dropped and reported, never run", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<Box>\n  <Button key="go" onClick={() => dangerous()} variant="outline">Go</Button>\n</Box>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.children?.[0]).toMatchObject({
      $ref: "Button",
      props: { variant: "outline", children: "Go" },
    });
    const button = result.node.children?.[0];
    expect(button && isComponentNode(button) ? Object.keys(button.props ?? {}) : []).toEqual([
      "variant",
      "children",
    ]);
    expect(result.notes.join(" ")).toContain("onClick");
  });

  test("the JSX an app would hold: data, a list, a condition and a local component", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      `import { Card } from "@/components/ui/card";

const stats = [
  { label: "Active users", value: 8420, up: true },
  { label: "Churn", value: 1.9, up: false },
];

function Stat({ label, value, up }: { label: string; value: number; up: boolean }) {
  return (
    <Card className={cn("p-4", up ? "text-green-600" : "text-red-600")}>
      <Text>{label}</Text>
      <Heading>{value.toLocaleString("en-US")}</Heading>
      {up && <Badge>Up</Badge>}
    </Card>
  );
}

export default function Page() {
  const [tab] = useState("all");
  return (
    <Box className="grid gap-4" data-tab={tab}>
      {stats.map((stat) => (
        <Stat key={stat.label} {...stat} />
      ))}
    </Box>
  );
}`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node).toMatchObject({ $ref: "Box", props: { "data-tab": "all" } });
    expect(result.node.children).toHaveLength(2);
    expect(result.node.children?.[0]).toMatchObject({
      $ref: "Card",
      props: { className: "p-4 text-green-600" },
      children: [
        { $ref: "Text", props: { children: "Active users" } },
        { $ref: "Heading", props: { children: "8,420" } },
        { $ref: "Badge", props: { children: "Up" } },
      ],
    });
    const second = result.node.children?.[1];
    expect(second).toMatchObject({ props: { className: "p-4 text-red-600" } });
    expect(
      isComponentNode(second as Node) && (second as { children: Node[] }).children,
    ).toHaveLength(2);
    expect(result.notes.join(" ")).toContain("Stat ×2");
    expect(result.notes.join(" ")).toContain("useState");
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

    // A screen has one root: several, however they are written, go in a plain
    // element, and the result says that it did.
    for (const jsx of ["<><Card /><Card /></>", "<Card /><Card />"]) {
      const twoRoots = await handler({ screenId: "landing", mode: "replace", jsx });
      expect(twoRoots.isError).toBeUndefined();
      expect(JSON.parse(twoRoots.content[0]?.text ?? "{}").sourceNotes.join(" ")).toContain(
        "several root elements",
      );
      expect(ctx.folder.screens.get("landing")?.tree).toMatchObject({
        $ref: "Box",
        props: { as: "div" },
        children: [{ $ref: "Card" }, { $ref: "Card" }],
      });
    }
    // Text on its own is still not a screen.
    const words = await handler({ screenId: "landing", mode: "replace", jsx: "<>Just words</>" });
    expect(words.isError).toBe(true);
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
        { $text: "Found " },
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

  test("text beside an element is a text node, with no wrapper of Velloo's own", async () => {
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
      // Bare text, as the app's own button holds it: it inherits the button's
      // color and size, and no `span` rule in the app's stylesheet reaches it.
      children: [{ $ref: "Icon" }, { $text: "Rewards" }],
    });
    // No `children` prop: the text lives in the tree, not in both places.
    expect(result.node.props?.children).toBeUndefined();
  });

  test("text nodes keep source order, and formatting whitespace is dropped", async () => {
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
      { $text: "Total" },
      { $ref: "Badge", props: { children: "3" } },
      { $text: "items" },
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
      { $text: "Move " },
      { $ref: "Badge", props: { children: "GN-48821" } },
      { $text: " off berth 4" },
      { $ref: "Badge", props: { children: "now" } },
    ]);
  });

  test("an inline element keeps the space at the edge of its text", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<h1><span>Ecommerce. </span><span className="grad">Outcomes</span></h1>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    // Trimmed, the two spans render as "Ecommerce.Outcomes".
    expect(result.node.children).toMatchObject([
      { $ref: "Box", props: { as: "span", children: "Ecommerce. " } },
      { $ref: "Box", props: { as: "span", children: "Outcomes" } },
    ]);
  });

  test("a space between two inline elements is a word space, however it is written", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const children = async (jsx: string) => {
      const result = await compileRestrictedJsx(ctx, screen, jsx);
      if (!result.ok || !isComponentNode(result.node)) throw new Error(JSON.stringify(result));
      return result.node.children;
    };
    const spaced = [
      { $ref: "Box", props: { as: "span", children: "Ecommerce." } },
      { $text: " " },
      { $ref: "Box", props: { as: "span", children: "Outcomes" } },
    ];
    expect(await children("<h1><span>Ecommerce.</span> <span>Outcomes</span></h1>")).toMatchObject(
      spaced,
    );
    expect(
      await children('<h1><span>Ecommerce.</span>{" "}<span>Outcomes</span></h1>'),
    ).toMatchObject(spaced);
    // Spelled out, it is kept between anything — the author asked for it.
    expect(await children('<Box><Badge>a</Badge>{" "}<Badge>b</Badge></Box>')).toMatchObject([
      { $ref: "Badge" },
      { $text: " " },
      { $ref: "Badge" },
    ]);
  });

  test("a space typed between two blocks is not a node", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    // One line of JSX with spaces between the tags is how the call was typed.
    // Kept, each space would be an invisible child that shifts every index
    // path after it.
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      "<Box> <Card><Button>A</Button> <Button>B</Button></Card> <Card /> </Box>",
    );
    if (!result.ok || !isComponentNode(result.node)) throw new Error(JSON.stringify(result));
    expect(result.node.children).toMatchObject([
      { $ref: "Card", children: [{ $ref: "Button" }, { $ref: "Button" }] },
      { $ref: "Card" },
    ]);
    expect(result.node.children).toHaveLength(2);
  });

  test("text beside an element emits as the text the app would write", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<ul className="jobs"><li>Remote <a href="/apply">Apply</a> today</li></ul>',
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const emitted = { ...screen, tree: result.node };
    const context = await emitFrameworkContextFor(emitted, ctx.providers, ctx.defaultProvider);
    const code = unwrap(await emitCode(emitted, context.emit));
    // No <span> the app never had, and the spaces survive the line breaks.
    expect(code.jsx).not.toContain("<span");
    expect(code.jsx).toContain('{"Remote "}');
    expect(code.jsx).toContain('<a href="/apply">Apply</a>');
    expect(code.jsx).toContain('{" today"}');
  });

  test("SVG's camelCase elements compose and emit as themselves", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      ctx,
      screen,
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stopColor="red" /></linearGradient></defs><rect fill="url(#g)" width="10" height="10" /></svg>',
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.node).toMatchObject({
      $ref: "Box",
      props: { as: "svg" },
      children: [
        {
          props: { as: "defs" },
          children: [{ $ref: "Box", props: { as: "linearGradient", id: "g" } }],
        },
        { props: { as: "rect" } },
      ],
    });

    const emitted = { ...screen, tree: result.node };
    const context = await emitFrameworkContextFor(emitted, ctx.providers, ctx.defaultProvider);
    const code = unwrap(await emitCode(emitted, context.emit));
    // A shape that loses its attributes on the way out draws nothing.
    expect(code.jsx).toContain('<svg viewBox="0 0 10 10">');
    expect(code.jsx).toContain('<linearGradient id="g">');
    expect(code.jsx).toContain('<stop offset="0" stopColor="red" />');
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
      expect(refused.issues[0]?.message).toContain("is not defined in this JSX");
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

describe("a screen read back as JSX", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{
    isError?: true;
    content: { type: "text"; text: string }[];
  }>;
  const tool = (name: string, register: (mcp: McpServer) => void): Handler => {
    let handler: Handler | undefined;
    register({
      registerTool: (registered: string, _config: unknown, cb: Handler) => {
        if (registered === name) handler = cb;
      },
    } as unknown as McpServer);
    if (!handler) throw new Error(`${name} was not registered`);
    return handler;
  };
  const SOURCE = `<main vellooId="page" className="grid gap-4">
  <Card vellooId="hero" style={{ opacity: 0.8 }}>
    <Heading>Team "analytics" {beta}</Heading>
    <p>Remote <a href="/jobs">Apply</a> now</p>
    <Button variant="outline" disabled icon={<Icon name="bolt" />}>Save</Button>
  </Card>
  <FeatureCard vellooId="f1" title="Fast" className="col-span-2">
    <Badge>New</Badge>
  </FeatureCard>
</main>`.replace("{beta}", '{"{beta}"}');

  test("composes back to the same nodes", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const first = await compileRestrictedJsx(ctx, screen, SOURCE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const printed = await printJsx(ctx, screen, first.node);
    expect(printed.notInJsx).toEqual([]);
    // Lowercase tags come back as the tags they were written as.
    expect(printed.jsx).toContain('<main vellooId="page" className="grid gap-4">');
    expect(printed.jsx).toContain('<p>Remote <a href="/jobs">Apply</a> now</p>');
    expect(printed.jsx).toContain(
      '<FeatureCard vellooId="f1" title="Fast" className="col-span-2">',
    );
    const second = await compileRestrictedJsx(ctx, screen, printed.jsx);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.node).toEqual(first.node);
  });

  test("get_screen prints a subtree, and compose replaces that one node", async () => {
    const compose = tool("compose", (mcp) => registerComposeTool(mcp, ctx));
    const getScreen = tool("get_screen", (mcp) => registerDiscoveryTools(mcp, ctx));
    expect(
      (await compose({ screenId: "landing", mode: "replace", jsx: SOURCE })).isError,
    ).toBeUndefined();

    const read = await getScreen({ screenId: "landing", mode: "jsx", path: "@hero" });
    const body = JSON.parse(read.content[0]?.text ?? "{}") as { jsx: string; path: number[] };
    expect(body.path).toEqual([0]);
    expect(body.jsx.startsWith('<Card vellooId="hero"')).toBe(true);

    const edited = body.jsx
      .replace(">Save<", ">Publish<")
      .replace('variant="outline"', 'variant="default"');
    const written = await compose({
      screenId: "landing",
      mode: "replace",
      path: "@hero",
      jsx: edited,
    });
    expect(written.isError).toBeUndefined();
    expect(JSON.parse(written.content[0]?.text ?? "{}")).toMatchObject({ path: [0] });
    const tree = ctx.folder.screens.get("landing")?.tree as { children: Node[] };
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]).toMatchObject({
      $ref: "Card",
      $id: "hero",
      children: [{}, {}, { $ref: "Button", props: { variant: "default", children: "Publish" } }],
    });
    // The sibling the edit never mentioned is untouched.
    expect(tree.children[1]).toMatchObject({ $snippet: "feature-card", $id: "f1" });

    const missing = await compose({
      screenId: "landing",
      mode: "replace",
      path: "@nope",
      jsx: "<Box />",
    });
    expect(missing.isError).toBe(true);
  });

  test("a list reads back as a list, and edits to its one template reach every item", async () => {
    const compose = tool("compose", (mcp) => registerComposeTool(mcp, ctx));
    const getScreen = tool("get_screen", (mcp) => registerDiscoveryTools(mcp, ctx));
    const source = `const teams = ["Aurora", "Beacon", "Cobalt", "Drift"];
<main vellooId="teams">
  {teams.map((team) => (
    <Card key={team} className="flex items-center justify-between rounded-lg border border-border p-4 shadow-sm">
      <Heading className="text-base font-semibold tracking-tight">{team}</Heading>
      <Badge variant="outline">Active</Badge>
    </Card>
  ))}
</main>`;
    await compose({ screenId: "landing", mode: "replace", jsx: source });
    const before = structuredClone(ctx.folder.screens.get("landing")?.tree);
    const { jsx } = JSON.parse(
      (await getScreen({ screenId: "landing", mode: "jsx" })).content[0]?.text ?? "{}",
    ) as { jsx: string };
    expect(jsx).toContain('{ text: "Aurora" },');
    expect(jsx.match(/<Card /g)).toHaveLength(1);
    // What was read composes back to exactly the tree it was read from…
    await compose({ screenId: "landing", mode: "replace", jsx });
    expect(ctx.folder.screens.get("landing")?.tree).toEqual(before as Node);
    // …and one edit to the template is an edit to all four cards.
    await compose({
      screenId: "landing",
      mode: "replace",
      jsx: jsx.replace('variant="outline"', 'variant="secondary"'),
    });
    const edited = ctx.folder.screens.get("landing")?.tree;
    const cards = edited && isComponentNode(edited) ? (edited.children ?? []) : [];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card).toMatchObject({
        children: [{}, { $ref: "Badge", props: { variant: "secondary" } }],
      });
    }
  });

  test("replacing the tree of a screen that doesn't exist creates it and gives it a frame", async () => {
    const compose = tool("compose", (mcp) => registerComposeTool(mcp, ctx));
    const written = await compose({
      screenId: "team-analytics",
      mode: "replace",
      jsx: "<main><Heading>Team analytics</Heading></main>",
    });
    expect(written.isError).toBeUndefined();
    const body = JSON.parse(written.content[0]?.text ?? "{}") as {
      created: { screen: string; board: string; frame: string };
    };
    expect(body.created).toMatchObject({ screen: "team-analytics" });
    expect(ctx.folder.screens.get("team-analytics")).toMatchObject({
      name: "Team Analytics",
      tree: { $ref: "Box", props: { as: "main" } },
    });
    const board = ctx.folder.boards.get(body.created.board);
    expect(board?.frames.map((frame) => frame.screen)).toContain("team-analytics");

    // A second new screen joins the same board; an existing screen is replaced, not re-created.
    const second = await compose({ screenId: "reports", mode: "replace", jsx: "<main />" });
    expect(JSON.parse(second.content[0]?.text ?? "{}").created.board).toBe(body.created.board);
    const again = await compose({ screenId: "reports", mode: "replace", jsx: "<section />" });
    expect(JSON.parse(again.content[0]?.text ?? "{}").created).toBeUndefined();

    // One edit from an existing id is a typo to report; an append never creates.
    const typo = await compose({ screenId: "report", mode: "replace", jsx: "<main />" });
    expect(typo.isError).toBe(true);
    expect(typo.content[0]?.text).toContain('Did you mean \\"reports\\"');
    expect(ctx.folder.screens.has("report")).toBe(false);
    const append = await compose({ screenId: "brand-new", mode: "append", jsx: "<Box />" });
    expect(append.isError).toBe(true);
  });
});

describe("a frame compose placed fits its screen", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{
    isError?: true;
    content: { type: "text"; text: string }[];
  }>;

  test("sized to the content when the screen is made, and again as it is rewritten, until someone sizes it", async () => {
    let height: number | null = 1337;
    let handler: Handler | undefined;
    registerComposeTool(
      {
        registerTool: (name: string, _config: unknown, cb: Handler) => {
          if (name === "compose") handler = cb;
        },
      } as unknown as McpServer,
      ctx,
      undefined,
      createFrameFitter(ctx, async () => height),
    );
    if (!handler) throw new Error("compose was not registered");
    const compose = handler;
    const frameOf = (boardId: string) =>
      ctx.folder.boards.get(boardId)?.frames.find((frame) => frame.screen === "tall-page");

    const made = JSON.parse(
      (await compose({ screenId: "tall-page", mode: "replace", jsx: "<main>Long</main>" }))
        .content[0]?.text ?? "{}",
    ) as { created: { board: string; note: string } };
    expect(frameOf(made.created.board)).toMatchObject({ w: 1440, h: 1337, fit: "content" });
    expect(made.created.note).toContain("1440×1337 sized to its content");

    // The page grew: the frame follows, and the result says so.
    height = 1500;
    const grown = JSON.parse(
      (await compose({ screenId: "tall-page", mode: "replace", jsx: "<main>Longer</main>" }))
        .content[0]?.text ?? "{}",
    ) as { framesFitted?: { h: number }[] };
    expect(grown.framesFitted).toMatchObject([{ h: 1500 }]);
    // Shorter than a viewport is still a viewport; a subtree edit measures nothing.
    height = 300;
    await compose({ screenId: "tall-page", mode: "replace", jsx: "<main>Short</main>" });
    expect(frameOf(made.created.board)?.h).toBe(900);

    // Someone sized it: from here the height is theirs.
    const frame = frameOf(made.created.board);
    if (!frame) throw new Error("missing frame");
    unwrap(
      await updateFrames(ctx, {
        boardId: made.created.board,
        patches: [{ frameId: frame.id, patch: { h: 2000 } }],
      }),
    );
    height = 1200;
    const kept = JSON.parse(
      (await compose({ screenId: "tall-page", mode: "replace", jsx: "<main>Again</main>" }))
        .content[0]?.text ?? "{}",
    ) as { framesFitted?: unknown };
    expect(kept.framesFitted).toBeUndefined();
    expect(frameOf(made.created.board)?.h).toBe(2000);
    expect(frameOf(made.created.board)?.fit).toBeUndefined();
  });

  test("where nothing can measure, the frame is the viewport and nothing is claimed", async () => {
    let handler: Handler | undefined;
    registerComposeTool(
      {
        registerTool: (name: string, _config: unknown, cb: Handler) => {
          if (name === "compose") handler = cb;
        },
      } as unknown as McpServer,
      ctx,
      undefined,
      createFrameFitter(ctx, async () => null),
    );
    const made = JSON.parse(
      (await handler?.({ screenId: "unmeasured", mode: "replace", jsx: "<main />" }))?.content[0]
        ?.text ?? "{}",
    ) as { created: { note: string } };
    expect(made.created.note).toContain("1440×900.");
    expect(made.created.note).not.toContain("sized to its content");
  });
});

describe("emit_code folds look-alike siblings into a list", () => {
  const SOURCE = `
const stats = [
  { label: "Active users", value: "8,420", delta: "+12.4%", up: true },
  { label: "Revenue", value: "$48.2k", delta: "+8.1%", up: true },
  { label: "Avg. session", value: "4m 38s", delta: "+3.2%", up: true },
  { label: "Churn", value: "1.9%", delta: "-0.6%", up: false },
];
const bars = [40, 65, 52, 78, 60, 88, 72, 95, 80, 100];
<main className="mx-auto max-w-5xl p-8">
  <section className="grid grid-cols-4 gap-4">
    {stats.map((stat) => (
      <div key={stat.label} className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-3xl font-bold tracking-tight">{stat.value}</span>
          <span className={cn("text-sm font-semibold", stat.up ? "text-primary" : "text-destructive")}>{stat.delta}</span>
        </div>
      </div>
    ))}
  </section>
  <div className="mt-6 flex h-40 items-end gap-2 rounded-lg border border-border bg-card p-4">
    {bars.map((height) => (
      <div key={height} className="w-full rounded-t-md bg-primary/80 transition-colors hover:bg-primary" style={{ height: height + "%" }} />
    ))}
  </div>
</main>`;
  test("the folded JSX is shorter and composes to the same nodes as the tree written out", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const compiled = await compileRestrictedJsx(ctx, screen, SOURCE);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { emit } = await emitFrameworkContextFor(screen, ctx.providers, ctx.defaultProvider);
    const design = { ...screen, tree: compiled.node };
    const folded = unwrap(await emitCode(design, emit)).jsx;
    const flat = unwrap(await emitCode(design, { ...emit, foldRepeats: false })).jsx;

    expect(folded).toContain("].map((item, index) => (");
    expect(folded.match(/\.map\(/g)).toHaveLength(2);
    expect(folded).toContain(
      '{ text: "Active users", text2: "8,420", className: "text-primary", text3: "+12.4%" },',
    );
    expect(folded).toContain('{ style: { height: "40%" } },');
    expect(folded.length).toBeLessThan(flat.length * 0.7);
    // The fold changes how the code is written, never what it renders: both
    // compose to the same nodes.
    const [fromFolded, fromFlat] = await Promise.all([
      compileRestrictedJsx(ctx, screen, folded),
      compileRestrictedJsx(ctx, screen, flat),
    ]);
    expect(fromFolded.ok && fromFlat.ok).toBe(true);
    if (!fromFolded.ok || !fromFlat.ok) return;
    expect(fromFolded.node).toEqual(fromFlat.node);
  });
});

describe("compose reads a page out of the app", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{
    isError?: true;
    content: { type: "text"; text: string }[];
  }>;
  let app: string;
  let compose: Handler;

  beforeAll(async () => {
    // The design folder sits at <host>/<tmp>, so its host root is the directory above it.
    app = `velloo-jsx-app-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dir = join(tmp, "..", app);
    await mkdir(join(dir, "lib"), { recursive: true });
    await writeFile(
      join(dir, "lib/teams.ts"),
      'export const teams = [{ name: "Aurora", value: 12400 }, { name: "Beacon", value: 8150 }];\n',
    );
    await writeFile(
      join(dir, "page.tsx"),
      `import { teams } from "./lib/teams";

export default function Page() {
  return (
    <main className="grid gap-2">
      {teams.map((team) => (
        <Card key={team.name} onClick={() => open(team)}>
          <Heading>{team.name}</Heading>
          <Text>{"$" + team.value.toLocaleString("en-US")}</Text>
        </Card>
      ))}
    </main>
  );
}
`,
    );
    let handler: Handler | undefined;
    registerComposeTool(
      {
        registerTool: (name: string, _config: unknown, cb: Handler) => {
          if (name === "compose") handler = cb;
        },
      } as unknown as McpServer,
      ctx,
    );
    if (!handler) throw new Error("compose was not registered");
    compose = handler;
  });

  afterAll(async () => {
    await rm(join(tmp, "..", app), { recursive: true, force: true });
  });

  test("the file's JSX, with the data it imports from beside it", async () => {
    const written = await compose({
      screenId: "from-file",
      mode: "replace",
      file: `${app}/page.tsx`,
    });
    expect(written.isError).toBeUndefined();
    expect(JSON.parse(written.content[0]?.text ?? "{}").sourceNotes.join(" ")).toContain("onClick");
    expect(ctx.folder.screens.get("from-file")?.tree).toMatchObject({
      $ref: "Box",
      props: { as: "main", className: "grid gap-2" },
      children: [
        {
          $ref: "Card",
          children: [{ props: { children: "Aurora" } }, { props: { children: "$12,400" } }],
        },
        {
          $ref: "Card",
          children: [{ props: { children: "Beacon" } }, { props: { children: "$8,150" } }],
        },
      ],
    });
  });

  test("an app-router page is composed inside the layouts above it", async () => {
    const dir = join(tmp, "..", app, "app");
    await mkdir(join(dir, "teams"), { recursive: true });
    await writeFile(
      join(dir, "layout.tsx"),
      `import { Inter } from "next/font/google";
const inter = Inter({ subsets: ["latin"] });
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen">
        <header>Site</header>
        <main>{children}</main>
      </body>
    </html>
  );
}
`,
    );
    await writeFile(
      join(dir, "teams/page.tsx"),
      "export default function Page() { return <Heading>Teams</Heading>; }\n",
    );
    const written = await compose({
      screenId: "teams-page",
      mode: "replace",
      file: `${app}/app/teams/page.tsx`,
    });
    expect(written.isError).toBeUndefined();
    expect(JSON.parse(written.content[0]?.text ?? "{}").sourceNotes.join(" ")).toContain(
      "app/layout.tsx",
    );
    expect(ctx.folder.screens.get("teams-page")?.tree).toMatchObject({
      $ref: "Box",
      props: { as: "div", className: "min-h-screen" },
      children: [
        { $ref: "Box", props: { as: "header", children: "Site" } },
        { $ref: "Box", props: { as: "main" }, children: [{ $ref: "Heading" }] },
      ],
    });
    // A file that is not a route's page is composed as itself.
    const plain = await compose({
      screenId: "from-file",
      mode: "replace",
      file: `${app}/page.tsx`,
    });
    expect(JSON.parse(plain.content[0]?.text ?? "{}").sourceNotes.join(" ")).not.toContain(
      "layout",
    );
  });

  test("only a source file inside the app, and one of jsx or file", async () => {
    for (const file of ["../../etc/hosts", `${app}/missing.tsx`, `${app}/lib`]) {
      const refused = await compose({ screenId: "landing", mode: "replace", file });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toContain("could not read");
    }
    const both = await compose({
      screenId: "landing",
      mode: "replace",
      jsx: "<Box />",
      file: `${app}/page.tsx`,
    });
    expect(both.isError).toBe(true);
    const neither = await compose({ screenId: "landing", mode: "replace" });
    expect(neither.isError).toBe(true);
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

  test("a slot given several elements holds them as nodes, and emits them as a fragment", async () => {
    const screen = ctx.folder.screens.get("landing");
    if (!screen) throw new Error("missing screen");
    const result = await compileRestrictedJsx(
      withRepo(),
      screen,
      "<AppAvatar badges={[<Badge>New</Badge>, <Badge>Hot</Badge>]} />",
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !isComponentNode(result.node)) return;
    expect(result.node.props?.badges).toMatchObject([
      { $ref: "Badge", props: { children: "New" } },
      { $ref: "Badge", props: { children: "Hot" } },
    ]);
    const { emit } = await emitFrameworkContextFor(screen, ctx.providers, ctx.defaultProvider);
    const { jsx } = unwrap(await emitCode({ ...screen, tree: result.node }, emit));
    expect(jsx).toBe(
      [
        "<AppAvatar badges={",
        "  <>",
        "    <Badge>New</Badge>",
        "    <Badge>Hot</Badge>",
        "  </>",
        "} />",
      ].join("\n"),
    );
  });

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
  // `<div>` to become, and compose failed with advice naming components the
  // folder doesn't have.
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
          { $text: "Total " },
          { $ref: "Box", props: { as: "b", children: "3" } },
        ],
      });

      const emitted = { ...screen, tree: result.node };
      const context = await emitFrameworkContextFor(emitted, antd.providers, antd.defaultProvider);
      const code = unwrap(await emitCode(emitted, context.emit));
      expect(code.jsx).toContain('<div style={{ display: "flex", gap: "8px" }}>');
      expect(code.jsx).toContain("<span>Hi</span>");
      expect(code.jsx).toContain('{"Total "}');
      expect(code.jsx).toContain("<b>3</b>");
      expect(code.jsx).not.toContain("Box");
      expect(code.helpersToMaterialize).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  test("a library with no element component says so, and still takes text beside an element", async () => {
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
      // A text node needs no component to hold it.
      if (!mixed.ok) throw new Error(JSON.stringify(mixed.issues));
      expect(mixed.node).toMatchObject({ children: [{ $ref: "Icon" }, { $text: "Rewards" }] });
    } finally {
      await cleanup();
    }
  });
});

/**
 * The compose tool promises lowercase HTML on every screen — so every library
 * has to register an element component — and keeps text written beside an
 * element as text. Iterating the schema's own id list means a new provider is
 * held to it the day it is added.
 */
describe("every library can lower lowercase HTML and hold text beside it", () => {
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
          if (isTextNode(node)) refs.push(node.$text);
          if (!isComponentNode(node)) return;
          refs.push([node.$ref, node.props?.as]);
          for (const child of node.children ?? []) walk(child);
        };
        walk(result.node);
        expect(refs).toEqual([[element, "div"], [element, "span"], "Total ", [element, "b"]]);
      } finally {
        await cleanup();
      }
    });
  }
});
