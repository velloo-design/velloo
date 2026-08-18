import { describe, expect, test } from "bun:test";
import type { Screen, Theme, Viewport } from "@velloo/schema";
import { registry } from "@velloo/shadcn-snapshot";
import { renderScreen, themeToCss, UnknownComponentError } from "../index.ts";

// Synthetic CSS so the renderer test stays a pure function test — actual
// Tailwind compilation is the server's TailwindJit concern.
const SNAPSHOT_CSS = "/* preflight stub */ .test { color: red; }";
const viewport: Viewport = { w: 800, h: 600 };
// Provider-agnostic renderer: tests pass the shadcn snapshot's registry
// explicitly (the snapshot is just a test fixture here, not a build-time
// dependency of the renderer itself).
const opts = { snapshotCss: SNAPSHOT_CSS, viewport, registry };

const sampleTheme: Theme = {
  name: "test",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.5 0.2 250)", foreground: "oklch(0.985 0 0)" },
  },
  typography: { fontFamily: { sans: "Inter, sans-serif" } },
  spacing: { 1: 4 },
  radius: { md: 8 },
};

function screenWith(tree: Screen["tree"]): Screen {
  return {
    id: "test",
    name: "Test",
    tree,
  };
}

describe("renderScreen", () => {
  test("renders a single Button to HTML containing its text", async () => {
    const screen = screenWith({
      $ref: "Button",
      props: { variant: "default", children: "Click me" },
    });
    const { html, bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("Click me");
    expect(bodyHtml).toContain("<button");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<meta name="viewport" content="width=800');
  });

  test("renders a Card with nested Heading + Text + Button", async () => {
    const screen = screenWith({
      $ref: "Card",
      props: { className: "p-6 flex flex-col gap-4" },
      children: [
        { $ref: "Heading", props: { level: 1, children: "Welcome" } },
        { $ref: "Text", props: { children: "Get started by setting up your account." } },
        { $ref: "Button", props: { variant: "default", children: "Continue" } },
      ],
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("Welcome");
    expect(bodyHtml).toContain("<h1");
    expect(bodyHtml).toContain("Get started by setting up your account.");
    expect(bodyHtml).toContain("<button");
    expect(bodyHtml).toContain("Continue");
  });

  test("inlines the supplied snapshot CSS and theme overrides", async () => {
    const screen = screenWith({ $ref: "Button", props: { children: "x" } });
    const { html, themeCss } = await renderScreen(screen, sampleTheme, opts);
    expect(html).toContain("<style>");
    expect(html).toContain(SNAPSHOT_CSS);
    expect(themeCss).toContain("--color-primary: oklch(0.5 0.2 250);");
    expect(themeCss).toContain("--color-primary-foreground: oklch(0.985 0 0);");
    expect(html).toContain(themeCss);
  });

  test("throws UnknownComponentError on bad $ref", async () => {
    const screen = screenWith({ $ref: "Definitely-Not-A-Component", props: {} });
    await expect(renderScreen(screen, sampleTheme, opts)).rejects.toBeInstanceOf(
      UnknownComponentError,
    );
  });

  test("annotates every rendered element with data-node-path", async () => {
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { level: 1, children: "A" } },
        { $ref: "Text", props: { children: "B" } },
        { $ref: "Button", props: { children: "C" } },
      ],
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain('data-node-path=""');
    expect(bodyHtml).toContain('data-node-path="0"');
    expect(bodyHtml).toContain('data-node-path="1"');
    expect(bodyHtml).toContain('data-node-path="2"');
  });

  test("renders every post-Sprint-J shadcn component without throwing", async () => {
    // Pin the new palette so a regression that breaks one component
    // gets caught at unit-test speed, not at canvas-load-time.
    const trees: Screen["tree"][] = [
      { $ref: "Alert", children: [{ $ref: "AlertTitle", props: { children: "Heads up!" } }] },
      {
        $ref: "Avatar",
        children: [{ $ref: "AvatarFallback", props: { children: "RM" } }],
      },
      { $ref: "Skeleton", props: { className: "h-4 w-32" } },
      { $ref: "Textarea", props: { placeholder: "Tell us…" } },
      { $ref: "Progress", props: { value: 60 } },
      { $ref: "Switch" },
      { $ref: "Checkbox" },
      {
        $ref: "Tabs",
        props: { defaultValue: "a" },
        children: [
          {
            $ref: "TabsList",
            children: [
              { $ref: "TabsTrigger", props: { value: "a", children: "First" } },
              { $ref: "TabsTrigger", props: { value: "b", children: "Second" } },
            ],
          },
          { $ref: "TabsContent", props: { value: "a", children: "A content" } },
        ],
      },
      {
        $ref: "Table",
        children: [
          {
            $ref: "TableHeader",
            children: [
              {
                $ref: "TableRow",
                children: [{ $ref: "TableHead", props: { children: "Name" } }],
              },
            ],
          },
          {
            $ref: "TableBody",
            children: [
              {
                $ref: "TableRow",
                children: [{ $ref: "TableCell", props: { children: "Alice" } }],
              },
            ],
          },
        ],
      },
      {
        $ref: "Tooltip",
        children: [
          { $ref: "TooltipTrigger", props: { children: "Hover me" } },
          { $ref: "TooltipContent", props: { children: "Tip text" } },
        ],
      },
    ];

    for (const tree of trees) {
      const screen = screenWith(tree);
      const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
      expect(bodyHtml.length).toBeGreaterThan(0);
    }
  });

  test("renders every post-Sprint-L marketing helper", async () => {
    const trees: Screen["tree"][] = [
      {
        $ref: "SVG",
        props: { viewBox: "0 0 16 16", content: '<path d="M0 0h16v16H0z" />' },
      },
      {
        $ref: "Image",
        props: { src: "/assets/hero.jpg", alt: "hero", aspect: "16/9", treatment: "overlay-dark" },
      },
      {
        $ref: "Layer",
        props: { top: 24, left: "20%", z: 3 },
        children: [{ $ref: "Text", props: { children: "absolute" } }],
      },
      { $ref: "Divider", props: { variant: "gradient", label: "OR" } },
      { $ref: "Gradient", props: { preset: "mesh", className: "h-32 w-full" } },
    ];
    for (const tree of trees) {
      const screen = screenWith(tree);
      const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
      expect(bodyHtml.length).toBeGreaterThan(0);
    }
  });

  test("Image with focal carries object-position", async () => {
    const screen = screenWith({
      $ref: "Image",
      props: { src: "/a.jpg", alt: "x", aspect: "1/1", focal: { x: 0.25, y: 0.75 }, fill: true },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("object-position");
  });

  test("Divider with label renders the label inline", async () => {
    const screen = screenWith({ $ref: "Divider", props: { variant: "dotted", label: "OR" } });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("OR");
  });

  test("Layer applies positioning via inline style", async () => {
    const screen = screenWith({
      $ref: "Layer",
      props: { top: 10, right: "1rem", z: 5, pointerEvents: false },
      children: [{ $ref: "Text", props: { children: "x" } }],
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("absolute");
    expect(bodyHtml).toContain("10px");
    expect(bodyHtml).toContain("1rem");
    expect(bodyHtml).toContain("z-index:5");
    expect(bodyHtml).toContain("pointer-events:none");
  });

  test("Input with value and no onChange gets readOnly (canvas-safe contract)", async () => {
    // Pulse designs ship JSON like <Input value="Rod"> — without
    // readOnly React warns. The component auto-injects readOnly so
    // the iframe stays warning-free in design mode. Match the
    // attribute case-insensitively because react-dom-server emits
    // the JSX casing verbatim for some element/attribute pairs.
    const screen = screenWith({
      $ref: "Input",
      props: { value: "Rod" },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toMatch(/readonly=""/i);
    expect(bodyHtml).toContain('value="Rod"');
  });

  test("Input without value never injects readOnly", async () => {
    const screen = screenWith({
      $ref: "Input",
      props: { placeholder: "type here" },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).not.toMatch(/readonly/i);
  });

  test("Textarea with static value gets readOnly", async () => {
    const screen = screenWith({
      $ref: "Textarea",
      props: { value: "long-form text" },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toMatch(/readonly=""/i);
  });

  test("Checkbox with static `checked` swaps to defaultChecked", async () => {
    const screen = screenWith({ $ref: "Checkbox", props: { checked: true } });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    // Radix renders aria-checked, but the underlying input shouldn't be
    // a controlled-checkbox warning trigger (no `checked` prop on the
    // hidden input element).
    expect(bodyHtml).toContain('data-state="checked"');
  });

  test("includes the iframe runtime script in the document", async () => {
    const screen = screenWith({ $ref: "Button", props: { children: "x" } });
    const { html } = await renderScreen(screen, sampleTheme, opts);
    expect(html).toContain("__velloo_init");
    expect(html).toContain("__velloo-selected");
    expect(html).toContain("data-node-path");
  });

  test("renders every batch-1 component without throwing", async () => {
    const trees: Screen["tree"][] = [
      {
        $ref: "RadioGroup",
        props: { defaultValue: "a" },
        children: [
          { $ref: "RadioGroupItem", props: { value: "a", id: "a" } },
          { $ref: "RadioGroupItem", props: { value: "b", id: "b" } },
        ],
      },
      { $ref: "Slider", props: { defaultValue: [40], max: 100 } },
      {
        $ref: "Accordion",
        props: { type: "single", defaultValue: "one" },
        children: [
          {
            $ref: "AccordionItem",
            props: { value: "one" },
            children: [
              { $ref: "AccordionTrigger", props: { children: "Q?" } },
              { $ref: "AccordionContent", props: { children: "A." } },
            ],
          },
        ],
      },
      {
        $ref: "Collapsible",
        children: [
          { $ref: "CollapsibleTrigger", props: { children: "Show" } },
          { $ref: "CollapsibleContent", props: { children: "hidden body" } },
        ],
      },
      {
        $ref: "ScrollArea",
        props: { className: "h-32 w-48" },
        children: [{ $ref: "Text", props: { children: "scroll me" } }],
      },
      {
        $ref: "Breadcrumb",
        children: [
          {
            $ref: "BreadcrumbList",
            children: [
              {
                $ref: "BreadcrumbItem",
                children: [{ $ref: "BreadcrumbPage", props: { children: "Now" } }],
              },
            ],
          },
        ],
      },
      {
        $ref: "Pagination",
        children: [
          {
            $ref: "PaginationContent",
            children: [
              {
                $ref: "PaginationItem",
                children: [{ $ref: "PaginationLink", props: { children: "1", href: "#" } }],
              },
            ],
          },
        ],
      },
      { $ref: "Toggle", props: { defaultPressed: true, children: "B" } },
      {
        $ref: "ToggleGroup",
        props: { type: "single", defaultValue: "a" },
        children: [
          { $ref: "ToggleGroupItem", props: { value: "a", children: "A" } },
          { $ref: "ToggleGroupItem", props: { value: "b", children: "B" } },
        ],
      },
    ];
    for (const tree of trees) {
      const screen = screenWith(tree);
      const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
      expect(bodyHtml.length).toBeGreaterThan(0);
    }
  });

  test("renders batch-2 overlays inline (canvas-safe portal contract)", async () => {
    const trees: Screen["tree"][] = [
      {
        $ref: "Dialog",
        children: [
          { $ref: "DialogTrigger", props: { children: "Open" } },
          {
            $ref: "DialogContent",
            children: [
              {
                $ref: "DialogHeader",
                children: [{ $ref: "DialogTitle", props: { children: "Hello" } }],
              },
            ],
          },
        ],
      },
      {
        $ref: "AlertDialog",
        children: [
          { $ref: "AlertDialogTrigger", props: { children: "Open" } },
          {
            $ref: "AlertDialogContent",
            children: [{ $ref: "AlertDialogTitle", props: { children: "Sure?" } }],
          },
        ],
      },
      {
        $ref: "Sheet",
        children: [
          { $ref: "SheetTrigger", props: { children: "Open" } },
          {
            $ref: "SheetContent",
            props: { side: "right" },
            children: [{ $ref: "SheetTitle", props: { children: "Filters" } }],
          },
        ],
      },
      {
        $ref: "Popover",
        children: [
          { $ref: "PopoverTrigger", props: { children: "Open" } },
          { $ref: "PopoverContent", props: { children: "anchor body" } },
        ],
      },
      {
        $ref: "DropdownMenu",
        children: [
          { $ref: "DropdownMenuTrigger", props: { children: "Menu" } },
          {
            $ref: "DropdownMenuContent",
            children: [{ $ref: "DropdownMenuItem", props: { children: "Item 1" } }],
          },
        ],
      },
      {
        $ref: "Select",
        children: [
          {
            $ref: "SelectTrigger",
            children: [{ $ref: "SelectValue", props: { children: "Free" } }],
          },
          {
            $ref: "SelectContent",
            children: [
              { $ref: "SelectItem", props: { value: "free", selected: true, children: "Free" } },
              { $ref: "SelectItem", props: { value: "pro", children: "Pro" } },
            ],
          },
        ],
      },
    ];
    for (const tree of trees) {
      const screen = screenWith(tree);
      const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
      // Inline portal: the content must appear in the body, not portaled away.
      expect(bodyHtml).toContain("data-velloo-inline");
    }
  });

  test("renders batch-3 components (Toaster, Calendar, Carousel, Chart)", async () => {
    const trees: Screen["tree"][] = [
      {
        $ref: "Toaster",
        props: { position: "bottom-right" },
      },
      { $ref: "Calendar", props: { month: "2026-05-01", selected: "2026-05-15" } },
      {
        $ref: "Carousel",
        children: [
          {
            $ref: "CarouselContent",
            children: [{ $ref: "CarouselItem", props: { children: "slide" } }],
          },
          { $ref: "CarouselPrevious" },
          { $ref: "CarouselNext" },
        ],
      },
      {
        $ref: "Chart",
        props: {
          kind: "bar",
          data: [
            { x: "Mo", y: 4 },
            { x: "Tu", y: 6 },
          ],
        },
      },
      {
        $ref: "Chart",
        props: {
          kind: "line",
          color: "accent",
          data: [
            { x: 1, y: 2 },
            { x: 2, y: 5 },
            { x: 3, y: 3 },
          ],
        },
      },
      {
        $ref: "Chart",
        props: {
          kind: "area",
          data: [
            { x: 1, y: 1 },
            { x: 2, y: 4 },
          ],
        },
      },
    ];
    for (const tree of trees) {
      const screen = screenWith(tree);
      const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
      expect(bodyHtml.length).toBeGreaterThan(0);
    }
  });

  test("Calendar highlights selected and today", async () => {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    const screen = screenWith({
      $ref: "Calendar",
      props: { month: iso, selected: iso },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    // Selected day uses bg-primary.
    expect(bodyHtml).toContain("bg-primary");
  });

  test("Chart renders zero-data state without throwing", async () => {
    const screen = screenWith({ $ref: "Chart", props: { kind: "bar", data: [] } });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain('data-slot="chart"');
  });

  test("Chart renders a real echarts SVG with a multi-series legend + theme colors", async () => {
    const screen = screenWith({
      $ref: "Chart",
      props: {
        kind: "bar",
        categories: ["Mon", "Tue", "Wed"],
        series: [
          { name: "Revenue", data: [1200, 1900, 800] },
          { name: "Refunds", data: [200, 400, 150] },
        ],
        yLabel: "USD",
        tickFormat: "compact",
      },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain('data-slot="chart"');
    expect(bodyHtml).toContain("<svg");
    // Theme token, not a baked hex — so the chart flips under dark mode.
    expect(bodyHtml).toContain("var(--color-primary)");
    expect(bodyHtml).toContain("Revenue");
  });

  test("iframe runtime forwards Cmd/Ctrl+wheel as parentZoom", async () => {
    const screen = screenWith({ $ref: "Button", props: { children: "x" } });
    const { html } = await renderScreen(screen, sampleTheme, opts);
    expect(html).toContain("parentZoom");
  });
});

describe("themeToCss", () => {
  test("emits :root with mapped CSS variables", () => {
    const css = themeToCss(sampleTheme);
    expect(css).toMatch(/^:root \{/);
    expect(css).toContain("--color-background: oklch(1 0 0);");
    expect(css).toContain("--color-primary: oklch(0.5 0.2 250);");
    expect(css.trim().endsWith("}")).toBe(true);
  });

  test("ignores unknown color tokens (extra fields stripped at the boundary)", () => {
    const t = {
      ...sampleTheme,
      colors: { ...sampleTheme.colors, fuchsia: "oklch(0.5 0.2 320)" },
    } as unknown as Theme;
    const css = themeToCss(t);
    expect(css).not.toContain("fuchsia");
  });

  test("emits palette scales/roles as --color-* vars (root + dark)", () => {
    const t: Theme = {
      ...sampleTheme,
      palette: { "primary-600": "#4f46e5", "success-500": "#22c55e" },
      paletteDark: { "primary-600": "#818cf8" },
    };
    const css = themeToCss(t);
    expect(css).toContain("--color-primary-600: #4f46e5;");
    expect(css).toContain("--color-success-500: #22c55e;");
    expect(css).toMatch(/\.dark \{[^}]*--color-primary-600: #818cf8;/s);
  });
});

describe("inline rich text (node-valued children prop)", () => {
  test("mixed string + node children prop render inline, not as a crash", async () => {
    const screen = screenWith({
      $ref: "Heading",
      props: {
        level: 1,
        children: [
          "You get ",
          { $ref: "Text", props: { className: "text-primary", children: "the math right" } },
        ],
      },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("You get");
    expect(bodyHtml).toContain("the math right");
    expect(bodyHtml).toContain("text-primary");
  });

  test("a single node-valued children prop renders the element", async () => {
    const screen = screenWith({
      $ref: "Text",
      props: { children: { $ref: "Badge", props: { children: "New" } } },
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("New");
  });

  test("a plain string children prop still renders as text", async () => {
    const screen = screenWith({ $ref: "Text", props: { children: "just text" } });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("just text");
  });
});

describe("google fonts injection", () => {
  test("emits a correctly-encoded css2 link (no %2B / %40 corruption)", async () => {
    const themed: Theme = {
      ...sampleTheme,
      typography: {
        ...sampleTheme.typography,
        fontFamily: { ...sampleTheme.typography.fontFamily, heading: '"Cal Sans", sans-serif' },
        googleFonts: ["Cal+Sans", "Inter:wght@400..700"],
      },
    };
    const screen = screenWith({ $ref: "Button", props: { children: "x" } });
    const { html } = await renderScreen(screen, themed, opts);
    expect(html).toContain(
      "https://fonts.googleapis.com/css2?family=Cal+Sans&family=Inter:wght@400..700&display=swap",
    );
    // The old encodeURIComponent path corrupted spaces (+ -> %2B) and axis
    // specs (@ -> %40), so Google never resolved the family.
    expect(html).not.toContain("%2B");
    expect(html).not.toContain("%40");
  });
});

describe("Box as= polymorphic tag", () => {
  test('as="span" renders an inline span, not a div', async () => {
    const screen = screenWith({ $ref: "Box", props: { as: "span", children: "inline run" } });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("<span");
    expect(bodyHtml).toContain("inline run");
  });

  test("an unsafe/component-style as falls back to div", async () => {
    const screen = screenWith({ $ref: "Box", props: { as: "Script", children: "x" } });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("<div");
    expect(bodyHtml.toLowerCase()).not.toContain("<script");
  });
});
