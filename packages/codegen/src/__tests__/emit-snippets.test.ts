import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Page, Snippet } from "@velloo/schema";
import { emitCode, emitSnippet, snippetIdsReferenced } from "../emit-code/index.ts";

function tmpOut(): string {
  return join(
    tmpdir(),
    `velloo-emit-snip-${Date.now()}-${Math.random().toString(36).slice(2)}.tsx`,
  );
}

const featureCard: Snippet = {
  id: "feature-card",
  name: "Feature Card",
  params: [
    { name: "title", type: "string" },
    { name: "body", type: "string", default: "" },
    { name: "icon", type: "string", default: "Sparkles" },
  ],
  tree: {
    $ref: "Card",
    props: { className: "p-6 flex flex-col gap-3" },
    children: [
      { $ref: "Heading", props: { level: 3, children: { $param: "title" } } },
      { $ref: "Text", props: { children: { $param: "body" } } },
    ],
  },
};

describe("emitSnippet", () => {
  test("emits a typed React component with destructured params", async () => {
    const result = unwrap(await emitSnippet(featureCard, { outputPath: tmpOut() }));
    const code = result.code;
    expect(code).toContain("export interface FeatureCardProps");
    expect(code).toContain("title: string");
    expect(code).toContain("body: string");
    expect(code).toContain("icon: string");
    expect(code).toContain("export function FeatureCard({ title, body, icon }: FeatureCardProps)");
  });

  test("$param in props.children becomes {paramName}", async () => {
    const result = unwrap(await emitSnippet(featureCard, { outputPath: tmpOut() }));
    expect(result.code).toContain("{title}");
    expect(result.code).toContain("{body}");
  });

  test("a snippet with no params emits a zero-arg component", async () => {
    const divider: Snippet = {
      id: "divider",
      name: "Divider",
      params: [],
      tree: { $ref: "Separator" },
    };
    const result = unwrap(await emitSnippet(divider, { outputPath: tmpOut() }));
    expect(result.code).toContain("export function Divider()");
    expect(result.code).not.toContain("DividerProps");
  });
});

describe("emitCode with snippet references", () => {
  test("snippet instances in a page emit as <PascalName ... /> with the right import", async () => {
    const page: Page = {
      name: "Marketing",
      variants: [
        {
          id: "mobile",
          name: "Mobile",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            children: [
              { $snippet: "feature-card", args: { title: "Fast", body: "Snappy by default." } },
              { $snippet: "feature-card", args: { title: "Friendly" } },
            ],
          },
        },
      ],
    };
    const snippets = new Map([[featureCard.id, featureCard]]);
    const result = unwrap(
      await emitCode(page, { variantId: "mobile", outputPath: tmpOut(), snippets }),
    );
    expect(result.code).toContain(
      'import { FeatureCard } from "@/components/ui/../snippets/FeatureCard"',
    );
    expect(result.code).toContain("<FeatureCard");
    expect(result.code).toContain('title="Fast"');
    expect(result.code).toContain('body="Snappy by default."');
  });

  test("snippetIdsReferenced collects referenced ids", () => {
    const page: Page = {
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 1, h: 1 },
          tree: {
            $ref: "Card",
            children: [{ $snippet: "feature-card" }, { $snippet: "hero" }],
          },
        },
      ],
    };
    const ids = snippetIdsReferenced(page);
    expect([...ids].sort()).toEqual(["feature-card", "hero"]);
  });
});
