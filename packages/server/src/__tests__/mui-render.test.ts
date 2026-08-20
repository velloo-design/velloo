import { describe, expect, test } from "bun:test";
import { createProvider } from "@velloo/provider-mui";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme } from "@velloo/schema";

/**
 * The framework-native milestone: a MUI-native screen SSRs to REAL MUI markup
 * with its emotion styles captured — in-process, no client bundle. Proves the
 * adapter's registry + emotion renderPass work end-to-end through the renderer.
 */

const mui = createProvider();

const theme: Theme = {
  name: "t",
  colors: {
    background: "#ffffff",
    foreground: "#111827",
    primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
  },
  typography: { fontFamily: { sans: "Inter, sans-serif" } },
  spacing: { 1: 4 },
  radius: { md: 12 },
};

const screen: Screen = {
  id: "s",
  name: "S",
  tree: {
    $ref: "Card",
    props: { variant: "outlined" },
    children: [
      {
        $ref: "CardContent",
        children: [
          { $ref: "Typography", props: { variant: "h5", children: "Hello MUI" } },
          { $ref: "Button", props: { variant: "contained", color: "primary", children: "Go" } },
        ],
      },
    ],
  },
};

describe("MUI adapter SSR", () => {
  test("renders real MUI components + extracts emotion CSS", async () => {
    const { html, bodyHtml } = await renderScreen(screen, theme, {
      viewport: { w: 1280, h: 800 },
      snapshotCss: "",
      registry: mui.registry,
      renderPass: mui.renderPass?.(theme),
    });
    // Real MUI components rendered (their stable class names + content).
    expect(bodyHtml).toContain("MuiCard-root");
    expect(bodyHtml).toContain("MuiButton-root");
    expect(bodyHtml).toContain("MuiButton-contained");
    expect(bodyHtml).toContain("Hello MUI");
    expect(bodyHtml).toContain("Go");
    // The emotion render pass injected a tagged style block with real rules
    // (the cache key "vmui" prefixes the generated classes).
    expect(html).toContain("data-velloo-adapter");
    expect(html).toMatch(/\.vmui-[\w-]+\s*\{/); // emotion rule(s) extracted
    // velloo theme tokens projected onto MUI: primary + radius reached the components.
    expect(html).toContain("#4f46e5");
    expect(html).toContain("border-radius:12px");
  });

  test("adapter declares the sx style channel (not Tailwind)", () => {
    expect(mui.styleChannel?.kind).toBe("sx");
    expect(mui.styleChannel?.needsTailwindJit).toBe(false);
  });
});
