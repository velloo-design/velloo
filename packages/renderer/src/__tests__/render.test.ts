import { describe, expect, test } from "bun:test";
import type { Screen, Theme, Viewport } from "@velloo/schema";
import { renderScreen, themeToCss, UnknownComponentError } from "../index.ts";

// Synthetic CSS so the renderer test stays a pure function test — actual
// Tailwind compilation is the server's TailwindJit concern.
const SNAPSHOT_CSS = "/* preflight stub */ .test { color: red; }";
const viewport: Viewport = { w: 800, h: 600 };
const opts = { snapshotCss: SNAPSHOT_CSS, viewport };

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

  test("includes the iframe runtime script in the document", async () => {
    const screen = screenWith({ $ref: "Button", props: { children: "x" } });
    const { html } = await renderScreen(screen, sampleTheme, opts);
    expect(html).toContain("__velloo_init");
    expect(html).toContain("__velloo-selected");
    expect(html).toContain("data-node-path");
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
});
