import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen, Snippet } from "@velloo/schema";
import { emitCode, snippetIdsReferenced } from "../emit-code/index.ts";

function screenOf(tree: Screen["tree"]): Screen {
  return { id: "home", name: "Home", tree };
}

describe("emitCode", () => {
  test("serializes a component tree to JSX with metadata", async () => {
    const screen = screenOf({
      $ref: "Card",
      props: { className: "p-6" },
      children: [
        {
          $ref: "CardHeader",
          children: [{ $ref: "CardTitle", props: { children: "Welcome" } }],
        },
        { $ref: "Button", props: { variant: "outline", children: "Get started" } },
      ],
    });

    const result = unwrap(await emitCode(screen));
    expect(result.jsx).toBe(
      `<Card className="p-6">
  <CardHeader>
    <CardTitle>Welcome</CardTitle>
  </CardHeader>
  <Button variant="outline">Get started</Button>
</Card>`,
    );
    expect(result.screen).toEqual({ id: "home", name: "Home" });
    expect(result.componentsUsed).toEqual(["Button", "Card", "CardHeader", "CardTitle"]);
    expect(result.classesUsed).toEqual(["p-6"]);
    expect(result.iconsUsed).toEqual([]);
    expect(result.snippetsUsed).toEqual([]);
  });

  test("lowers velloo primitives to plain HTML and strips consumed props", async () => {
    const heading = unwrap(
      await emitCode(screenOf({ $ref: "Heading", props: { level: 3, children: "Pricing" } })),
    );
    expect(heading.jsx).toBe(`<h3 className="text-3xl font-semibold tracking-tight">Pricing</h3>`);
    expect(heading.jsx).not.toContain("level=");

    const text = unwrap(
      await emitCode(
        screenOf({ $ref: "Text", props: { variant: "muted", children: "Pick a plan" } }),
      ),
    );
    expect(text.jsx).toBe(`<p className="text-sm text-muted-foreground">Pick a plan</p>`);
    expect(text.jsx).not.toContain("variant=");
  });

  test("consolidates Tailwind classes deterministically", async () => {
    // Conflicting utilities inside one className: later wins.
    const button = unwrap(
      await emitCode(screenOf({ $ref: "Button", props: { className: "p-2 p-4" } })),
    );
    expect(button.jsx).toBe(`<Button className="p-4" />`);

    // A node's own className overrides the lowered primitive's defaults.
    const heading = unwrap(
      await emitCode(
        screenOf({
          $ref: "Heading",
          props: { level: 1, className: "text-sm", children: "Fine print" },
        }),
      ),
    );
    expect(heading.jsx).toContain("text-sm");
    expect(heading.jsx).not.toContain("text-5xl");
  });

  test("emits lucide JSX names for Icon and reports them in iconsUsed", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Card",
          children: [
            { $ref: "Icon", props: { name: "Sparkles", className: "size-4" } },
            // Non-PascalCase names fall back to HelpCircle — the fallback
            // appears in the JSX, so it must appear in iconsUsed too.
            { $ref: "Icon", props: { name: "arrow-right" } },
          ],
        }),
      ),
    );
    expect(result.jsx).toContain(`<Sparkles className="size-4" />`);
    expect(result.jsx).toContain(`<HelpCircle />`);
    expect(result.iconsUsed).toEqual(["HelpCircle", "Sparkles"]);
  });

  test("emits snippet instances with args and carries each snippet's own IR", async () => {
    const featureCard: Snippet = {
      id: "feature-card",
      name: "feature card",
      params: [
        { name: "title", type: "string", default: "Untitled" },
        { name: "highlighted", type: "boolean" },
      ],
      tree: {
        $ref: "Card",
        props: { className: "p-6" },
        children: [{ $ref: "CardTitle", props: { children: { $param: "title" } } }],
      },
    };
    const screen = screenOf({
      $ref: "Card",
      children: [{ $snippet: "feature-card", args: { title: "Fast" }, $extraClassName: "mt-4" }],
    });

    const result = unwrap(
      await emitCode(screen, { snippets: new Map([[featureCard.id, featureCard]]) }),
    );
    expect(result.jsx).toBe(
      `<Card>
  <FeatureCard title="Fast" className="mt-4" />
</Card>`,
    );
    // Transitive components inside the snippet body surface in componentsUsed.
    expect(result.componentsUsed).toEqual(["Card", "CardTitle"]);

    expect(result.snippetsUsed.length).toBe(1);
    const ir = result.snippetsUsed[0];
    expect(ir?.componentName).toBe("FeatureCard");
    expect(ir?.params).toEqual([
      { name: "title", type: "string", default: "Untitled" },
      { name: "highlighted", type: "boolean" },
    ]);
    expect(ir?.jsx).toBe(
      `<Card className="p-6">
  <CardTitle>{title}</CardTitle>
</Card>`,
    );

    expect([...snippetIdsReferenced(screen)]).toEqual(["feature-card"]);
  });

  test("emits velloo composition helpers verbatim (the sample screens use them)", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Card",
          children: [
            { $ref: "Gradient", props: { preset: "mesh", className: "absolute inset-0" } },
            { $ref: "Layer", props: { top: 24, z: 2 } },
            { $ref: "Image", props: { src: "assets/hero.png", aspect: "16/9" } },
            { $ref: "SVG", props: { content: "<path d='M0 0' />" } },
            { $ref: "Divider", props: { variant: "gradient", label: "OR" } },
          ],
        }),
      ),
    );
    expect(result.jsx).toContain(`<Gradient className="absolute inset-0" preset="mesh" />`);
    expect(result.jsx).toContain(`<Layer top={24} z={2} />`);
    expect(result.jsx).toContain(`<Image src="assets/hero.png" aspect="16/9" />`);
    expect(result.jsx).toContain(`<Divider variant="gradient" label="OR" />`);
    expect(result.componentsUsed).toEqual(["Card", "Divider", "Gradient", "Image", "Layer", "SVG"]);
  });

  test("emits registered extensions as JSX with their declared id", async () => {
    const result = unwrap(
      await emitCode(screenOf({ $ref: "PriceChart", props: { period: "30d" } }), {
        extensions: { PriceChart: { importPath: "@/components/price-chart", props: [] } },
      }),
    );
    expect(result.jsx).toBe(`<PriceChart period="30d" />`);
    expect(result.componentsUsed).toEqual(["PriceChart"]);
  });

  test("returns UnknownComponent for unregistered refs, snippets, and stray params", async () => {
    const unknownRef = await emitCode(screenOf({ $ref: "Carousel3000" }));
    expect(unknownRef.ok).toBe(false);
    if (!unknownRef.ok) {
      expect(unknownRef.error).toEqual({ kind: "UnknownComponent", ref: "Carousel3000" });
    }

    const unknownSnippet = await emitCode(
      screenOf({ $ref: "Card", children: [{ $snippet: "ghost" }] }),
    );
    expect(unknownSnippet.ok).toBe(false);
    if (!unknownSnippet.ok) {
      expect(unknownSnippet.error).toEqual({ kind: "UnknownComponent", ref: "@ghost" });
    }

    // $param nodes are only valid inside a snippet body.
    const strayParam = await emitCode(screenOf({ $ref: "Card", children: [{ $param: "title" }] }));
    expect(strayParam.ok).toBe(false);
    if (!strayParam.ok) {
      expect(strayParam.error).toEqual({ kind: "UnknownComponent", ref: "$param:title" });
    }
  });
});
