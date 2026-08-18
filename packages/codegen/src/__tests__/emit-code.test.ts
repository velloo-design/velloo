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
            // kebab-case names normalize to the PascalCase lucide export.
            { $ref: "Icon", props: { name: "arrow-right" } },
            // Names that can't normalize to a JSX identifier fall back to
            // HelpCircle — the fallback appears in the JSX, so it must
            // appear in iconsUsed too.
            { $ref: "Icon", props: { name: "123 not an icon!" } },
          ],
        }),
      ),
    );
    expect(result.jsx).toContain(`<Sparkles className="size-4" />`);
    expect(result.jsx).toContain(`<ArrowRight />`);
    expect(result.jsx).toContain(`<HelpCircle />`);
    expect(result.iconsUsed).toEqual(["ArrowRight", "HelpCircle", "Sparkles"]);
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

  test("warns when a dynamic icon-name param bakes to the fallback, but a node param stays a slot", async () => {
    const row: Snippet = {
      id: "issue-row",
      name: "issue row",
      params: [
        { name: "priorityIcon", type: "icon", default: "SignalMedium" },
        { name: "statusDot", type: "node" },
      ],
      tree: {
        $ref: "Box",
        children: [
          // Dynamic icon NAME — can't survive lowering (tag must be literal).
          { $ref: "Icon", props: { name: { $param: "priorityIcon" } } },
          // Dynamic NODE — emits as a clean {slot}, no warning.
          { $param: "statusDot" },
        ],
      },
    };
    const screen = screenOf({ $ref: "Box", children: [{ $snippet: "issue-row" }] });
    const result = unwrap(await emitCode(screen, { snippets: new Map([[row.id, row]]) }));

    const ir = result.snippetsUsed[0];
    expect(ir?.jsx).toContain("<HelpCircle />");
    expect(ir?.jsx).toContain("{statusDot}");
    expect(ir?.warnings.length).toBe(1);
    expect(ir?.warnings[0]).toContain('Icon "name" is dynamic (param "priorityIcon")');
    expect(ir?.warnings[0]).toContain("node");
    // The screen body itself emits a clean <IssueRow /> — no warning there.
    expect(result.warnings).toEqual([]);
  });

  test("$if with eq serializes to a strict-equality ternary in snippet JSX", async () => {
    const tile: Snippet = {
      id: "stat-tile",
      name: "stat tile",
      params: [{ name: "trend", type: "enum", enum: ["up", "down", "flat"], default: "flat" }],
      tree: {
        $ref: "Card",
        props: {
          className: {
            $if: "trend",
            eq: "up",
            then: "text-emerald-600",
            else: "text-red-500",
          },
        },
      },
    };
    const screen = screenOf({ $ref: "Card", children: [{ $snippet: "stat-tile" }] });
    const result = unwrap(await emitCode(screen, { snippets: new Map([[tile.id, tile]]) }));
    expect(result.snippetsUsed[0]?.jsx).toBe(
      `<Card className={trend === "up" ? "text-emerald-600" : "text-red-500"} />`,
    );
  });

  test("instances with $overrides inline the resolved body instead of the component", async () => {
    const tip: Snippet = {
      id: "tip-card",
      name: "tip card",
      params: [{ name: "title", type: "string", default: "Tip" }],
      tree: {
        $ref: "Card",
        children: [
          { $ref: "CardTitle", props: { children: { $param: "title" } } },
          { $ref: "Badge", props: { variant: "secondary", children: "info" } },
        ],
      },
    };
    const screen = screenOf({
      $ref: "Card",
      children: [
        { $snippet: "tip-card", args: { title: "Plain" } },
        {
          $snippet: "tip-card",
          args: { title: "Special" },
          $overrides: { "1": { props: { variant: "destructive" } } },
        },
      ],
    });
    const result = unwrap(await emitCode(screen, { snippets: new Map([[tip.id, tip]]) }));
    // Un-overridden instance stays a component reference…
    expect(result.jsx).toContain('<TipCard title="Plain" />');
    // …the overridden one inlines with the patch applied and args substituted.
    expect(result.jsx).toContain("<CardTitle>Special</CardTitle>");
    expect(result.jsx).toContain('<Badge variant="destructive">info</Badge>');
    expect(result.jsx).not.toContain('<TipCard title="Special"');
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
    // Only Card is an installable shadcn primitive; the velloo composition
    // helpers (Gradient/Image/Layer/SVG/Divider) need no `shadcn add`.
    expect(result.componentsToInstall).toEqual(["card"]);
    // …but those helpers DO need authoring in the app.
    expect(result.helpersToMaterialize).toEqual(["Divider", "Gradient", "Image", "Layer", "SVG"]);
  });

  test("componentsToInstall lists kebab shadcn add targets, deduped, excluding helpers", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Card",
          children: [
            { $ref: "CardHeader", children: [{ $ref: "CardTitle", props: { children: "Hi" } }] },
            { $ref: "Button", props: { children: "Go" } },
            { $ref: "Badge", props: { children: "New" } },
            // Velloo helpers + a lucide icon — never installable.
            { $ref: "Box", children: [{ $ref: "Icon", props: { name: "Sparkles" } }] },
          ],
        }),
      ),
    );
    // Card + CardHeader + CardTitle collapse to one "card" target.
    expect(result.componentsToInstall).toEqual(["badge", "button", "card"]);
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

  test("inline rich text: mixed string + node children prop emits real JSX", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Box",
          props: {
            children: [
              "You get ",
              { $ref: "Box", props: { className: "text-primary", children: "the math right" } },
            ],
          },
        }),
      ),
    );
    // Text run as a string expression (exact spacing preserved); node child as
    // a real element — never a literal `{"$ref":…}` object.
    expect(result.jsx).toContain('{"You get "}');
    expect(result.jsx).toContain('<div className="text-primary">the math right</div>');
    expect(result.jsx).not.toContain("$ref");
    expect(result.classesUsed).toContain("text-primary");
  });

  test("a single node-valued children prop emits the nested element", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Box",
          props: { children: { $ref: "Badge", props: { children: "New" } } },
        }),
      ),
    );
    expect(result.jsx).toBe(`<div>
  <Badge>New</Badge>
</div>`);
  });

  test('Box as="span" lowers to <span> and consumes the as prop', async () => {
    const result = unwrap(
      await emitCode(
        screenOf({ $ref: "Box", props: { as: "span", className: "font-bold", children: "hi" } }),
      ),
    );
    expect(result.jsx).toBe('<span className="font-bold">hi</span>');
  });

  test("an unsafe Box as= falls back to <div>", async () => {
    const result = unwrap(
      await emitCode(screenOf({ $ref: "Box", props: { as: "Whatever", children: "hi" } })),
    );
    expect(result.jsx).toBe("<div>hi</div>");
  });
});
