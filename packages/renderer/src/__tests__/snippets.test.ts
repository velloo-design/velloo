import { describe, expect, test } from "bun:test";
import type { Screen, Snippet, SnippetParam, Theme, Viewport } from "@velloo/schema";
import { registry } from "@velloo/shadcn-snapshot";
import { createElement } from "react";
import {
  renderBody,
  renderScreen,
  resolveSnippetBodyForEdit,
  SnippetCycleError,
  SnippetParamError,
  snippetParamPlaceholder,
  UnknownSnippetError,
} from "../index.ts";

const theme: Theme = {
  name: "t",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.5 0.2 250)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const viewport: Viewport = { w: 320, h: 240 };
const opts = { snapshotCss: "", viewport, registry };

const featureCard: Snippet = {
  id: "feature-card",
  name: "Feature Card",
  params: [
    { name: "title", type: "string" },
    { name: "body", type: "string", default: "Default body." },
  ],
  tree: {
    $ref: "Card",
    children: [
      { $ref: "Heading", props: { level: 3, children: { $param: "title" } } },
      { $ref: "Text", props: { children: { $param: "body" } } },
    ],
  },
};

function screenWith(tree: Screen["tree"]): Screen {
  return { id: "s", name: "S", tree };
}

describe("snippet resolution", () => {
  test("instance with required + default param renders both", async () => {
    const snippets = new Map([[featureCard.id, featureCard]]);
    const screen = screenWith({ $snippet: "feature-card", args: { title: "Fast" } });
    const { bodyHtml } = await renderScreen(screen, theme, { ...opts, snippets });
    expect(bodyHtml).toContain("Fast");
    expect(bodyHtml).toContain("Default body.");
  });

  test("missing required param throws SnippetParamError", async () => {
    const snippets = new Map([[featureCard.id, featureCard]]);
    const screen = screenWith({ $snippet: "feature-card", args: {} });
    await expect(renderScreen(screen, theme, { ...opts, snippets })).rejects.toBeInstanceOf(
      SnippetParamError,
    );
  });

  test("an omitted optional node slot renders nothing (no error, no placeholder)", async () => {
    const header: Snippet = {
      id: "page-header",
      name: "Page Header",
      params: [
        { name: "title", type: "string" },
        { name: "action", type: "node", optional: true },
      ],
      tree: {
        $ref: "Box",
        children: [
          { $ref: "Heading", props: { level: 1, children: { $param: "title" } } },
          { $param: "action" },
        ],
      },
    };
    const snippets = new Map([[header.id, header]]);
    const screen = screenWith({ $snippet: "page-header", args: { title: "Dashboard" } });
    // Renders without throwing even though `action` was omitted.
    const { bodyHtml } = await renderScreen(screen, theme, { ...opts, snippets });
    expect(bodyHtml).toContain("Dashboard");

    // Supplying it still fills the slot.
    const withAction = screenWith({
      $snippet: "page-header",
      args: { title: "Dashboard", action: { $ref: "Button", props: { children: "New" } } },
    });
    const filled = await renderScreen(withAction, theme, { ...opts, snippets });
    expect(filled.bodyHtml).toContain("New");
  });

  test("unknown snippet throws UnknownSnippetError", async () => {
    const screen = screenWith({ $snippet: "no-such-snippet" });
    await expect(renderScreen(screen, theme, opts)).rejects.toBeInstanceOf(UnknownSnippetError);
  });

  test("snippet of a snippet renders the inner body correctly", async () => {
    // Outer wraps Feature Card inside a banner Card so we can confirm
    // nested resolution works end-to-end.
    const wrapper: Snippet = {
      id: "wrapper",
      name: "Wrapper",
      params: [{ name: "label", type: "string" }],
      tree: {
        $ref: "Card",
        children: [
          { $ref: "Heading", props: { level: 2, children: { $param: "label" } } },
          { $snippet: "feature-card", args: { title: "Fast", body: "Snappy by default." } },
        ],
      },
    };
    const snippets = new Map([
      [featureCard.id, featureCard],
      [wrapper.id, wrapper],
    ]);
    const screen = screenWith({ $snippet: "wrapper", args: { label: "Section" } });
    const { bodyHtml } = await renderScreen(screen, theme, { ...opts, snippets });
    expect(bodyHtml).toContain("Section");
    expect(bodyHtml).toContain("Fast");
    expect(bodyHtml).toContain("Snappy by default.");
  });

  test("snippet body referencing itself triggers SnippetCycleError", async () => {
    const recursive: Snippet = {
      id: "recur",
      name: "Recur",
      params: [],
      tree: { $ref: "Card", children: [{ $snippet: "recur" }] },
    };
    const snippets = new Map([[recursive.id, recursive]]);
    const screen = screenWith({ $snippet: "recur" });
    await expect(renderScreen(screen, theme, { ...opts, snippets })).rejects.toBeInstanceOf(
      SnippetCycleError,
    );
  });

  test("$if in className picks the right branch based on boolean param", async () => {
    const card: Snippet = {
      id: "tier",
      name: "Pricing Tier",
      params: [{ name: "featured", type: "boolean", default: false }],
      tree: {
        $ref: "Card",
        props: {
          className: {
            $if: "featured",
            then: "ring-2 ring-emerald-500/40",
            else: "ring-1 ring-zinc-800",
          },
        },
      },
    };
    const snippets = new Map([[card.id, card]]);
    const featured = await renderScreen(
      screenWith({ $snippet: "tier", args: { featured: true } }),
      theme,
      { ...opts, snippets },
    );
    expect(featured.bodyHtml).toContain("ring-2");
    expect(featured.bodyHtml).toContain("ring-emerald-500/40");
    const plain = await renderScreen(
      screenWith({ $snippet: "tier", args: { featured: false } }),
      theme,
      { ...opts, snippets },
    );
    expect(plain.bodyHtml).toContain("ring-1");
    expect(plain.bodyHtml).toContain("ring-zinc-800");
  });

  test("$overrides patch interior nodes of one instance only", async () => {
    const tip: Snippet = {
      id: "tip",
      name: "Tip",
      params: [],
      tree: {
        $ref: "Card",
        children: [{ $ref: "Badge", props: { variant: "secondary", children: "info" } }],
      },
    };
    const snippets = new Map([[tip.id, tip]]);
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $snippet: "tip" },
        {
          $snippet: "tip",
          $overrides: { "0": { props: { variant: "destructive", children: "ALERT" } } },
        },
      ],
    });
    const out = await renderScreen(screen, theme, { ...opts, snippets });
    expect(out.bodyHtml).toContain("ALERT");
    expect(out.bodyHtml).toContain("info");
    expect(out.bodyHtml).toContain('data-variant="destructive"');
    expect(out.bodyHtml).toContain('data-variant="secondary"');
  });

  test("$if with eq branches on enum param equality", async () => {
    const tile: Snippet = {
      id: "stat",
      name: "Stat tile",
      params: [{ name: "trend", type: "enum", enum: ["up", "down", "flat"], default: "flat" }],
      tree: {
        $ref: "Card",
        props: {
          className: {
            $if: "trend",
            eq: "up",
            then: "text-emerald-600",
            else: { $if: "trend", eq: "down", then: "text-red-500", else: "text-muted-foreground" },
          },
        },
      },
    };
    const snippets = new Map([[tile.id, tile]]);
    const up = await renderScreen(screenWith({ $snippet: "stat", args: { trend: "up" } }), theme, {
      ...opts,
      snippets,
    });
    expect(up.bodyHtml).toContain("text-emerald-600");
    const down = await renderScreen(
      screenWith({ $snippet: "stat", args: { trend: "down" } }),
      theme,
      { ...opts, snippets },
    );
    expect(down.bodyHtml).toContain("text-red-500");
    const flat = await renderScreen(
      screenWith({ $snippet: "stat", args: { trend: "flat" } }),
      theme,
      { ...opts, snippets },
    );
    expect(flat.bodyHtml).toContain("text-muted-foreground");
  });

  test("$if in props.children renders the selected branch", async () => {
    const label: Snippet = {
      id: "label",
      name: "Label",
      params: [{ name: "loud", type: "boolean", default: false }],
      tree: {
        $ref: "Text",
        props: { children: { $if: "loud", then: "LOUD!", else: "quiet" } },
      },
    };
    const snippets = new Map([[label.id, label]]);
    const loud = await renderScreen(
      screenWith({ $snippet: "label", args: { loud: true } }),
      theme,
      { ...opts, snippets },
    );
    expect(loud.bodyHtml).toContain("LOUD!");
    expect(loud.bodyHtml).not.toContain("quiet");
  });

  test("$extraClassName appends to the resolved root's className", async () => {
    const card: Snippet = {
      id: "card",
      name: "Card",
      params: [],
      tree: { $ref: "Card", props: { className: "p-6" } },
    };
    const snippets = new Map([[card.id, card]]);
    const { bodyHtml } = await renderScreen(
      screenWith({ $snippet: "card", $extraClassName: "ring-2 ring-emerald-500" }),
      theme,
      { ...opts, snippets },
    );
    expect(bodyHtml).toContain("p-6");
    expect(bodyHtml).toContain("ring-2");
    expect(bodyHtml).toContain("ring-emerald-500");
  });

  test("$extraClassName forwards through a nested snippet root", async () => {
    const inner: Snippet = {
      id: "inner",
      name: "Inner",
      params: [],
      tree: { $ref: "Card", props: { className: "p-2" } },
    };
    const outer: Snippet = {
      id: "outer",
      name: "Outer",
      params: [],
      tree: { $snippet: "inner" },
    };
    const snippets = new Map([
      [inner.id, inner],
      [outer.id, outer],
    ]);
    const { bodyHtml } = await renderScreen(
      screenWith({ $snippet: "outer", $extraClassName: "border-2" }),
      theme,
      { ...opts, snippets },
    );
    expect(bodyHtml).toContain("p-2");
    expect(bodyHtml).toContain("border-2");
  });

  test("a node param accepts an array of nodes and renders them as siblings", async () => {
    const bar: Snippet = {
      id: "actions-bar",
      name: "Actions Bar",
      params: [{ name: "actions", type: "node" }],
      tree: {
        $ref: "Box",
        children: [
          { $ref: "Heading", props: { level: 3, children: "Title" } },
          { $param: "actions" },
        ],
      },
    };
    const snippets = new Map([[bar.id, bar]]);
    const screen = screenWith({
      $snippet: "actions-bar",
      args: {
        actions: [
          { $ref: "Text", props: { children: "Save" } },
          { $ref: "Badge", props: { children: "Cancel" } },
        ],
      },
    });
    const { bodyHtml } = await renderScreen(screen, theme, { ...opts, snippets });
    expect(bodyHtml).toContain("Save");
    expect(bodyHtml).toContain("Cancel");
  });

  test("a node param still accepts a single node", async () => {
    const slot: Snippet = {
      id: "slotted",
      name: "Slotted",
      params: [{ name: "body", type: "node" }],
      tree: { $ref: "Box", children: [{ $param: "body" }] },
    };
    const snippets = new Map([[slot.id, slot]]);
    const screen = screenWith({
      $snippet: "slotted",
      args: { body: { $ref: "Text", props: { children: "Just one" } } },
    });
    const { bodyHtml } = await renderScreen(screen, theme, { ...opts, snippets });
    expect(bodyHtml).toContain("Just one");
  });

  test("inner DOM in a resolved snippet inherits the instance's data-node-path", () => {
    const snippets = new Map([[featureCard.id, featureCard]]);
    const screen = screenWith({
      $ref: "Card",
      children: [{ $snippet: "feature-card", args: { title: "X" } }],
    });
    const html = renderBody(screen, registry, snippets);
    const matches = html.match(/data-node-path="0"/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("preview placeholders for unbound params", () => {
  test("a declared default wins — that is what a default is for", () => {
    expect(snippetParamPlaceholder({ name: "crumb", type: "string", default: "Settings" })).toBe(
      "Settings",
    );
    expect(snippetParamPlaceholder({ name: "rows", type: "number", default: 3 })).toBe(3);
  });

  test("a required param reads as its own name, $-prefixed", () => {
    expect(snippetParamPlaceholder({ name: "label", type: "string" })).toBe("$label");
    expect(snippetParamPlaceholder({ name: "tone", type: "enum", enum: ["a", "b"] })).toBe("a");
  });

  test("a required node slot becomes a tag that needs no library component", async () => {
    // The tag used to be a shadcn Badge, which a no-library or MUI folder has
    // no entry for — the whole preview 422'd on an UnknownComponentError.
    const sidebar: SnippetParam = { name: "sidebar", type: "node" };
    const shell: Snippet = {
      id: "shell",
      name: "Shell",
      params: [sidebar],
      tree: { $ref: "Box", children: [{ $param: "sidebar" }] },
    };
    const bare = { Box: (p: Record<string, unknown>) => createElement("div", p) };
    const { bodyHtml } = await renderScreen(
      screenWith({ $snippet: "shell", args: { sidebar: snippetParamPlaceholder(sidebar) } }),
      theme,
      { ...opts, registry: bare, snippets: new Map([[shell.id, shell]]) },
    );
    expect(bodyHtml).toContain("$sidebar");
    expect(bodyHtml).toContain("dashed");
  });

  test("the editor preview tags the same slot, so both previews read alike", () => {
    const shell: Snippet = {
      id: "shell",
      name: "Shell",
      params: [{ name: "sidebar", type: "node" }],
      tree: { $ref: "Box", children: [{ $param: "sidebar" }] },
    };
    const bare = { Box: (p: Record<string, unknown>) => createElement("div", p) };
    const body = resolveSnippetBodyForEdit(shell.tree, { sidebar: "$sidebar" }, shell.id);
    const html = renderBody(screenWith(body), bare);
    expect(html).toContain("$sidebar");
    // The slot keeps its own path, so its siblings don't shift under it.
    expect(html).toContain('data-node-path="0"');
  });
});
