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
