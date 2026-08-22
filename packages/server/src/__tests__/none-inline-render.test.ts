import { describe, expect, test } from "bun:test";
import { createProvider } from "@velloo/provider-none";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme } from "@velloo/schema";
import { registryForScreen } from "../extensions/registry.ts";

/**
 * The CSS-framework axis end-to-end for the no-library provider: a `none/none`
 * folder (`config.styling.framework === "none"`) renders the inline-styled
 * primitives — real `style="…"`, no Tailwind classes — so it paints with the
 * JIT off; a `none/tailwind` folder keeps the Tailwind-classed primitives.
 */

const none = createProvider();
const providers = { none };

const theme: Theme = {
  name: "t",
  colors: {
    background: "#ffffff",
    foreground: "#111827",
    border: "#e5e7eb",
    primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
    card: { DEFAULT: "#ffffff", foreground: "#111827" },
  },
  typography: { fontFamily: { sans: "Inter, sans-serif" } },
  spacing: {},
  radius: { md: 10 },
};

const screen: Screen = {
  id: "s",
  name: "S",
  library: "none",
  tree: {
    $ref: "Stack",
    props: { direction: "col", gap: 6, style: { padding: "40px" } },
    children: [{ $ref: "Card", children: [{ $ref: "Button", props: { children: "Go" } }] }],
  },
};

function render(folderCss: "none" | "tailwind") {
  return renderScreen(screen, theme, {
    viewport: { w: 800, h: 600 },
    snapshotCss: "",
    registry: registryForScreen(screen, providers, none, {}, folderCss),
  });
}

describe("no-framework × CSS framework", () => {
  test("none/none renders inline styles, not Tailwind classes", async () => {
    const { bodyHtml } = await render("none");
    // Stack's structural default is inline flex (gap-6 ⇒ 1.5rem), no `class="flex`.
    expect(bodyHtml).toMatch(/display:\s*flex/);
    expect(bodyHtml).toMatch(/flex-direction:\s*column/);
    expect(bodyHtml).toMatch(/gap:\s*1\.5rem/);
    expect(bodyHtml).not.toContain('class="flex');
    // Card + Button visual defaults via theme CSS vars (radius/border), no JIT.
    expect(bodyHtml).toContain("border-radius:var(--radius)");
    expect(bodyHtml).toContain("var(--color-card)");
    // The node's authored style merges in.
    expect(bodyHtml).toContain("padding:40px");
    expect(bodyHtml).toContain("Go");
  });

  test("none/tailwind keeps the Tailwind-classed primitives", async () => {
    const { bodyHtml } = await render("tailwind");
    // Tailwind path: structural defaults are utility classes, not inline flex.
    expect(bodyHtml).toContain('class="flex');
    expect(bodyHtml).not.toMatch(/style="[^"]*display:\s*flex/);
  });

  test("the provider exposes both channels; none resolves to inline `style`", () => {
    expect(none.styleChannels).toEqual(["tailwind-classname", "style"]);
    // Inline registry's Box is a distinct component from the Tailwind one.
    const inline = none.registryForChannel?.("style");
    const tw = none.registryForChannel?.("tailwind-classname");
    expect(inline?.Box).toBeDefined();
    expect(inline?.Box).not.toBe(tw?.Box);
  });
});
