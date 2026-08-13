import { describe, expect, test } from "bun:test";
import type { Snippet, Theme, Variant } from "@velloo/schema";
import {
  renderBody,
  renderVariant,
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

const opts = { snapshotCss: "" };

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

function variantWith(tree: Variant["tree"]): Variant {
  return { id: "v", name: "V", viewport: { w: 320, h: 240 }, tree };
}

describe("snippet resolution", () => {
  test("instance with required + default param renders both", async () => {
    const snippets = new Map([[featureCard.id, featureCard]]);
    const variant = variantWith({ $snippet: "feature-card", args: { title: "Fast" } });
    const { bodyHtml } = await renderVariant(variant, theme, { ...opts, snippets });
    expect(bodyHtml).toContain("Fast");
    expect(bodyHtml).toContain("Default body.");
  });

  test("missing required param throws SnippetParamError", async () => {
    const snippets = new Map([[featureCard.id, featureCard]]);
    const variant = variantWith({ $snippet: "feature-card", args: {} });
    await expect(renderVariant(variant, theme, { ...opts, snippets })).rejects.toBeInstanceOf(
      SnippetParamError,
    );
  });

  test("unknown snippet throws UnknownSnippetError", async () => {
    const variant = variantWith({ $snippet: "no-such-snippet" });
    await expect(renderVariant(variant, theme, opts)).rejects.toBeInstanceOf(UnknownSnippetError);
  });

  test("snippet body referencing itself triggers SnippetCycleError", async () => {
    const recursive: Snippet = {
      id: "recur",
      name: "Recur",
      params: [],
      tree: { $ref: "Card", children: [{ $snippet: "recur" }] },
    };
    const snippets = new Map([[recursive.id, recursive]]);
    const variant = variantWith({ $snippet: "recur" });
    await expect(renderVariant(variant, theme, { ...opts, snippets })).rejects.toBeInstanceOf(
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
    const featured = await renderVariant(
      variantWith({ $snippet: "tier", args: { featured: true } }),
      theme,
      { ...opts, snippets },
    );
    expect(featured.bodyHtml).toContain("ring-2");
    expect(featured.bodyHtml).toContain("ring-emerald-500/40");
    const plain = await renderVariant(
      variantWith({ $snippet: "tier", args: { featured: false } }),
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
    const loud = await renderVariant(
      variantWith({ $snippet: "label", args: { loud: true } }),
      theme,
      { ...opts, snippets },
    );
    expect(loud.bodyHtml).toContain("LOUD!");
    expect(loud.bodyHtml).not.toContain("quiet");
  });

  test("inner DOM in a resolved snippet inherits the instance's data-node-path", () => {
    const snippets = new Map([[featureCard.id, featureCard]]);
    // Wrap the snippet inside a Card so the instance lives at path [0].
    const variant = variantWith({
      $ref: "Card",
      children: [{ $snippet: "feature-card", args: { title: "X" } }],
    });
    const html = renderBody(variant, snippets);
    // The snippet instance is at path 0; every node inside the snippet body
    // should also carry data-node-path="0" since the snippet is opaque.
    const matches = html.match(/data-node-path="0"/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
