import { describe, expect, test } from "bun:test";
import type { Screen, Snippet, Theme, Viewport } from "@velloo/schema";
import {
  renderBody,
  renderScreen,
  SnippetCycleError,
  SnippetParamError,
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
const opts = { snapshotCss: "", viewport };

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

  test("unknown snippet throws UnknownSnippetError", async () => {
    const screen = screenWith({ $snippet: "no-such-snippet" });
    await expect(renderScreen(screen, theme, opts)).rejects.toBeInstanceOf(UnknownSnippetError);
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

  test("inner DOM in a resolved snippet inherits the instance's data-node-path", () => {
    const snippets = new Map([[featureCard.id, featureCard]]);
    const screen = screenWith({
      $ref: "Card",
      children: [{ $snippet: "feature-card", args: { title: "X" } }],
    });
    const html = renderBody(screen, snippets);
    const matches = html.match(/data-node-path="0"/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
