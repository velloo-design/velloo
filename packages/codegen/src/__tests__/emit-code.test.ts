import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import {
  headingClasses,
  headingInlineStyle,
  type Screen,
  type Snippet,
  textClasses,
  textInlineStyle,
} from "@velloo/schema";
import { emitCode } from "../emit-code/index.ts";

function screenOf(tree: Screen["tree"]): Screen {
  return { id: "home", name: "Home", tree };
}

describe("emitCode — inline-style channel (none/none)", () => {
  test("lowers no-lib primitives to plain HTML with inline style (no Tailwind, no imports)", async () => {
    const screen = screenOf({
      $ref: "Stack",
      props: { direction: "col", gap: 6, style: { padding: "40px" } },
      children: [
        {
          $ref: "Card",
          children: [
            { $ref: "Heading", props: { level: 2, children: "Hello" } },
            { $ref: "Button", props: { variant: "outline", children: "Go" } },
          ],
        },
      ],
    });
    const result = unwrap(await emitCode(screen, { inlineStyle: true }));
    // Plain HTML tags, not <Stack>/<Card>/<Button> imports.
    expect(result.jsx).toContain("<div");
    expect(result.jsx).toContain("<button");
    expect(result.jsx).toContain("<h2");
    expect(result.jsx).not.toContain("<Stack");
    expect(result.jsx).not.toContain("<Card");
    // Inline style with structural defaults; no className anywhere.
    expect(result.jsx).toContain("style={{");
    expect(result.jsx).toContain('display: "flex"');
    expect(result.jsx).toContain('gap: "1.5rem"');
    expect(result.jsx).not.toContain("className");
    // The node's authored style merges over the defaults.
    expect(result.jsx).toContain('padding: "40px"');
    // Button gets type="button"; consumed props (variant/level/direction) gone.
    expect(result.jsx).toContain('type="button"');
    expect(result.jsx).not.toContain("variant=");
    expect(result.jsx).not.toContain("direction=");
    // No shadcn install plan on a Tailwind-free folder.
    expect(result.componentsToInstall).toEqual([]);
    expect(result.helpersToMaterialize).toEqual([]);
  });

  // The one class a Tailwind-free folder legitimately emits: `typeset` is
  // velloo's own CSS (shipped by the emitted typeset.css), not a utility.
  test("Prose still emits its typeset class on the inline channel", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Prose",
          props: { as: "article", preset: "reading" },
          children: [{ $ref: "Text", props: { children: "Copy" } }],
        }),
        { inlineStyle: true },
      ),
    );
    expect(result.jsx).toContain("<article");
    expect(result.jsx).toContain("typeset");
    expect(result.jsx).toContain("typeset-reading");
    expect(result.jsx).not.toContain("preset=");
    expect(result.helpersToMaterialize).toEqual([]);
  });

  test("the inline typography ladder is var() references, so none/none folders are themed", async () => {
    const heading = unwrap(
      await emitCode(screenOf({ $ref: "Heading", props: { level: 2, children: "Hello" } }), {
        inlineStyle: true,
      }),
    );
    // Tokens, not baked rem values — the same ones the Tailwind channel's
    // `text-h2` utility reads, so both channels move with the typeset.
    expect(heading.jsx).toContain('fontSize: "var(--text-h2)"');
    expect(heading.jsx).toContain('lineHeight: "var(--leading-h2)"');
    expect(heading.jsx).toContain('letterSpacing: "var(--tracking-h2)"');
    expect(heading.jsx).toContain("fontWeight: 700");
    expect(heading.jsx).not.toMatch(/fontSize: "[\d.]+rem"/);

    const text = unwrap(
      await emitCode(screenOf({ $ref: "Text", props: { variant: "lead", children: "Copy" } }), {
        inlineStyle: true,
      }),
    );
    expect(text.jsx).toContain('fontSize: "var(--text-lead)"');
    expect(text.jsx).toContain('color: "var(--color-muted-foreground)"');
  });

  test("the emitted inline styles are the ones the runtime component renders", async () => {
    for (const level of [1, 3, 6]) {
      const emitted = unwrap(
        await emitCode(screenOf({ $ref: "Heading", props: { level, children: "T" } }), {
          inlineStyle: true,
        }),
      );
      for (const [prop, value] of Object.entries(headingInlineStyle(level))) {
        expect(emitted.jsx).toContain(
          typeof value === "number" ? `${prop}: ${value}` : `${prop}: "${value}"`,
        );
      }
    }
    for (const variant of ["default", "muted", "small", "lead"]) {
      const emitted = unwrap(
        await emitCode(screenOf({ $ref: "Text", props: { variant, children: "T" } }), {
          inlineStyle: true,
        }),
      );
      for (const [prop, value] of Object.entries(textInlineStyle(variant))) {
        expect(emitted.jsx).toContain(
          typeof value === "number" ? `${prop}: ${value}` : `${prop}: "${value}"`,
        );
      }
    }
  });

  test("Icon still lowers to a lucide import on the inline channel", async () => {
    const result = unwrap(
      await emitCode(screenOf({ $ref: "Icon", props: { name: "ArrowRight" } }), {
        inlineStyle: true,
      }),
    );
    expect(result.jsx).toContain("<ArrowRight");
    expect(result.iconsUsed).toContain("ArrowRight");
  });
});

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
    // The ladder is the theme's typeset, not a fixed Tailwind size — `text-h3`
    // resolves through the generated `--text-h3` token.
    expect(heading.jsx).toBe(
      `<h3 className="text-h3 leading-h3 tracking-h3 font-semibold">Pricing</h3>`,
    );
    expect(heading.jsx).not.toContain("level=");

    const text = unwrap(
      await emitCode(
        screenOf({ $ref: "Text", props: { variant: "muted", children: "Pick a plan" } }),
      ),
    );
    expect(text.jsx).toBe(
      `<p className="text-caption leading-caption tracking-caption font-normal text-muted-foreground">Pick a plan</p>`,
    );
    expect(text.jsx).not.toContain("variant=");
  });

  test("the emitted classes are the ones the runtime component renders", async () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const emitted = unwrap(
        await emitCode(screenOf({ $ref: "Heading", props: { level, children: "T" } })),
      );
      expect(emitted.jsx).toBe(`<h${level} className="${headingClasses(level)}">T</h${level}>`);
    }
    for (const variant of ["default", "muted", "small", "lead"]) {
      const emitted = unwrap(
        await emitCode(screenOf({ $ref: "Text", props: { variant, children: "T" } })),
      );
      expect(emitted.jsx).toBe(`<p className="${textClasses(variant)}">T</p>`);
    }
  });

  test("Prose emits the typeset region classes and needs nothing materialized", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Prose",
          props: { as: "article", preset: "docs", className: "max-w-prose" },
          children: [{ $ref: "Heading", props: { level: 2, children: "Install" } }],
        }),
      ),
    );
    expect(result.jsx).toContain("<article");
    expect(result.jsx).toContain("typeset");
    expect(result.jsx).toContain("typeset-docs");
    expect(result.jsx).toContain("max-w-prose");
    // Both props are consumed by the lowering, not leaked as DOM attributes.
    expect(result.jsx).not.toContain("preset=");
    expect(result.jsx).not.toContain('as="article"');
    // The `typeset` classes come from the emitted typeset.css, so unlike
    // Gradient/Divider there is no component for the agent to author.
    expect(result.helpersToMaterialize).not.toContain("Prose");
    expect(result.componentsToInstall).toEqual([]);
  });

  test("a Prose preset that is not ident-shaped is dropped, not emitted as a class", async () => {
    const result = unwrap(
      await emitCode(screenOf({ $ref: "Prose", props: { preset: "a b { color: red }" } })),
    );
    expect(result.jsx).toContain("typeset");
    expect(result.jsx).not.toContain("color: red");
  });

  test("preserves an object `style` prop as a JSX expression", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Box",
          props: {
            style: {
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.12) 1px, transparent 0)",
              backgroundSize: "14px 14px",
            },
          },
        }),
      ),
    );
    expect(result.jsx).toContain("style={{");
    expect(result.jsx).toContain(
      '"radial-gradient(circle at 1px 1px, rgba(0,0,0,0.12) 1px, transparent 0)"',
    );
    // Object props emit as idiomatic JS literals: bare identifier keys, spaced.
    expect(result.jsx).toContain('backgroundSize: "14px 14px"');
  });

  test("consolidates Tailwind classes deterministically", async () => {
    // Conflicting utilities inside one className: later wins.
    const button = unwrap(
      await emitCode(screenOf({ $ref: "Button", props: { className: "p-2 p-4" } })),
    );
    expect(button.jsx).toBe(`<Button className="p-4" />`);

    // A node's own className overrides the lowered primitive's defaults. The
    // typeset scale is theme-generated, so tailwind-merge has to be taught it
    // (`cn` extends the font-size group) or `text-h1` would read as a color and
    // survive alongside the author's size.
    const heading = unwrap(
      await emitCode(
        screenOf({
          $ref: "Heading",
          props: { level: 1, className: "text-sm", children: "Fine print" },
        }),
      ),
    );
    expect(heading.jsx).toContain("text-sm");
    expect(heading.jsx).not.toContain("text-h1");
    // `text-sm` carries its own line-height, so it correctly displaces
    // `leading-h1` — but not the tracking, which is a separate group.
    expect(heading.jsx).not.toContain("leading-h1");
    expect(heading.jsx).toContain("tracking-h1");

    // A color override replaces the tone without touching the size, because
    // they are separate groups.
    const text = unwrap(
      await emitCode(
        screenOf({
          $ref: "Text",
          props: { variant: "muted", className: "text-primary", children: "Note" },
        }),
      ),
    );
    expect(text.jsx).toContain("text-caption");
    expect(text.jsx).toContain("text-primary");
    expect(text.jsx).not.toContain("text-muted-foreground");
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

  test("a well-formed name lucide doesn't export emits HelpCircle, not a broken import", async () => {
    // "Github" is a valid JSX identifier, so a shape-only check passed it
    // through and emitted `import { Github } from "lucide-react"` — a name
    // lucide dropped, so it only failed in the consumer's build.
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Box",
          children: [
            { $ref: "Icon", props: { name: "github" } },
            { $ref: "Icon", props: { name: "Sparkles" } },
          ],
        }),
      ),
    );
    expect(result.jsx).not.toContain("Github");
    expect(result.jsx).toContain(`<HelpCircle />`);
    expect(result.iconsUsed).toEqual(["HelpCircle", "Sparkles"]);
    const warning = result.warnings.find((w) => w.includes('"github"'));
    expect(warning).toContain("not a lucide export");
    // Brand glyphs get the real fix, not a "did you mean" that can't help.
    expect(warning).toContain("SVG");
  });

  test("an unresolved icon inside a snippet body warns on that snippet's IR", async () => {
    const brandRow: Snippet = {
      id: "brand-row",
      name: "Brand Row",
      params: [],
      tree: { $ref: "Box", children: [{ $ref: "Icon", props: { name: "Twitter" } }] },
    };
    const result = unwrap(
      await emitCode(screenOf({ $snippet: "brand-row" }), {
        snippets: new Map([["brand-row", brandRow]]),
      }),
    );
    const ir = result.snippetsUsed.find((s) => s.id === "brand-row");
    expect(ir?.warnings.some((w) => w.includes('"Twitter"'))).toBe(true);
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
  });

  test("an optional node slot is marked optional in the IR and omitted instances drop it", async () => {
    const header: Snippet = {
      id: "page-header",
      name: "page header",
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
    const screen = screenOf({
      $ref: "Box",
      children: [{ $snippet: "page-header", args: { title: "Dashboard" } }],
    });
    const result = unwrap(await emitCode(screen, { snippets: new Map([[header.id, header]]) }));
    const ir = result.snippetsUsed[0];
    expect(ir?.params).toEqual([
      { name: "title", type: "string" },
      { name: "action", type: "node", optional: true },
    ]);
    // The body still emits the slot as {action} — a `name?: ReactNode` prop
    // renders nothing when the instance omits it.
    expect(ir?.jsx).toContain("{action}");
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

describe("emitCode — metadata from children-prop nodes", () => {
  test("counts an Icon rendered via a `children` prop, not just node.children", async () => {
    // A Button whose label is inline rich text: [<Icon/>, "Go"] in props.children.
    // emitTree renders the Icon, so iconsUsed + componentsUsed must include it.
    const screen = screenOf({
      $ref: "Button",
      props: {
        children: [{ $ref: "Icon", props: { name: "arrow-right" } }, "Go"],
      },
    });
    const result = unwrap(await emitCode(screen));
    expect(result.componentsUsed).toContain("Icon");
    expect(result.iconsUsed).toContain("ArrowRight");
    // The Icon is actually rendered in the JSX (not silently dropped from metadata).
    expect(result.jsx).toContain("ArrowRight");
  });
});
