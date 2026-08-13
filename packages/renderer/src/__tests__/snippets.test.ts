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
