import { describe, expect, test } from "bun:test";
import type { Theme, Variant } from "@velloo/schema";
import { renderVariant, themeToCss, UnknownComponentError } from "../index.ts";

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

function variantWith(tree: Variant["tree"]): Variant {
  return {
    id: "test",
    name: "Test",
    viewport: { w: 800, h: 600 },
    tree,
  };
}

describe("renderVariant", () => {
  test("renders a single Button to HTML containing its text", async () => {
    const variant = variantWith({
      $ref: "Button",
      props: { variant: "default", children: "Click me" },
    });
    const { html, bodyHtml } = await renderVariant(variant, sampleTheme);
    expect(bodyHtml).toContain("Click me");
    expect(bodyHtml).toContain("<button");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<meta name="viewport" content="width=800');
  });

  test("renders a Card with nested Heading + Text + Button (sample-page mobile)", async () => {
    const variant = variantWith({
      $ref: "Card",
      props: { className: "p-6 flex flex-col gap-4" },
      children: [
        { $ref: "Heading", props: { level: 1, children: "Welcome" } },
        { $ref: "Text", props: { children: "Get started by setting up your account." } },
        { $ref: "Button", props: { variant: "default", children: "Continue" } },
      ],
    });
    const { bodyHtml } = await renderVariant(variant, sampleTheme);
    expect(bodyHtml).toContain("Welcome");
    expect(bodyHtml).toContain("<h1");
    expect(bodyHtml).toContain("Get started by setting up your account.");
    expect(bodyHtml).toContain("<button");
    expect(bodyHtml).toContain("Continue");
  });

  test("inlines the snapshot CSS and theme overrides", async () => {
    const variant = variantWith({ $ref: "Button", props: { children: "x" } });
    const { html, themeCss } = await renderVariant(variant, sampleTheme);
    expect(html).toContain("<style>");
    // Tailwind preflight should be in the snapshot CSS.
    expect(html).toMatch(/preflight|tailwindcss|--tw-/);
    // Theme override — primary token should land as a CSS variable.
    expect(themeCss).toContain("--color-primary: oklch(0.5 0.2 250);");
    expect(themeCss).toContain("--color-primary-foreground: oklch(0.985 0 0);");
    expect(html).toContain(themeCss);
  });

  test("throws UnknownComponentError on bad $ref", async () => {
    const variant = variantWith({ $ref: "Definitely-Not-A-Component", props: {} });
    await expect(renderVariant(variant, sampleTheme)).rejects.toBeInstanceOf(UnknownComponentError);
  });

  test("annotates every rendered element with data-node-path", async () => {
    const variant = variantWith({
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { level: 1, children: "A" } },
        { $ref: "Text", props: { children: "B" } },
        { $ref: "Button", props: { children: "C" } },
      ],
    });
    const { bodyHtml } = await renderVariant(variant, sampleTheme);
    // Root path is "" (empty); children get 0, 1, 2.
    expect(bodyHtml).toContain('data-node-path=""');
    expect(bodyHtml).toContain('data-node-path="0"');
    expect(bodyHtml).toContain('data-node-path="1"');
    expect(bodyHtml).toContain('data-node-path="2"');
  });

  test("includes the iframe runtime script in the document", async () => {
    const variant = variantWith({ $ref: "Button", props: { children: "x" } });
    const { html } = await renderVariant(variant, sampleTheme);
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

  test("ignores unknown color tokens", () => {
    const t: Theme = { ...sampleTheme, colors: { ...sampleTheme.colors, fuchsia: "oklch(...)" } };
    const css = themeToCss(t);
    expect(css).not.toContain("fuchsia");
  });
});
