import { describe, expect, test } from "bun:test";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme, Viewport } from "@velloo/schema";
import { createProvider, NONE_MANIFEST, registry } from "../index.ts";

/**
 * Smoke tests for the no-library provider — proves the provider
 * abstraction actually works end-to-end with a non-shadcn registry.
 *
 * Imports through @velloo/renderer (not into any of the bare
 * components directly) so the assertion is the same one a real
 * `velloo run` would make: the renderer takes a registry and
 * produces HTML from a `$ref` tree.
 */

const sampleTheme: Theme = {
  name: "t",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.5 0.2 250)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};
const viewport: Viewport = { w: 800, h: 600 };

function screenWith(tree: Screen["tree"]): Screen {
  return { id: "t", name: "Test", tree };
}

describe("no-library provider", () => {
  test("createProvider returns a ComponentProvider with the right id + version", () => {
    const provider = createProvider();
    expect(provider.id).toBe("none");
    expect(typeof provider.version).toBe("string");
    expect(provider.registry.Box).toBeDefined();
    expect(provider.registry.Button).toBeDefined();
    // Reused velloo helper available too.
    expect(provider.registry.Heading).toBeDefined();
  });

  test("renderScreen against the no-lib registry produces a Box+Stack+Button page", async () => {
    const screen = screenWith({
      $ref: "Container",
      props: { size: "md", className: "py-10" },
      children: [
        {
          $ref: "Stack",
          props: { gap: 4 },
          children: [
            { $ref: "Heading", props: { level: 1, children: "Welcome" } },
            { $ref: "Text", props: { children: "Bare primitives." } },
            {
              $ref: "Button",
              props: { variant: "default", children: "Continue" },
            },
          ],
        },
      ],
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, {
      viewport,
      snapshotCss: "",
      registry,
    });
    expect(bodyHtml).toContain("Welcome");
    expect(bodyHtml).toContain("Bare primitives.");
    expect(bodyHtml).toContain("<button");
    // Container resolves to a centered max-width wrapper.
    expect(bodyHtml).toContain("max-w-screen-md");
  });

  test("Input with a static value gets readOnly (canvas-safe contract)", async () => {
    const { bodyHtml } = await renderScreen(
      screenWith({
        $ref: "Input",
        props: { value: "Hi", placeholder: "—" },
      }),
      sampleTheme,
      { viewport, snapshotCss: "", registry },
    );
    expect(bodyHtml).toMatch(/readonly=""/i);
  });

  test("manifest enumerates the documented surface", () => {
    const ids = NONE_MANIFEST.map((c) => c.id);
    for (const required of ["Box", "Stack", "Container", "Card", "Button", "Input"]) {
      expect(ids).toContain(required);
    }
    // Reused velloo helpers also show up so the inspector knows their props.
    for (const helper of ["Heading", "Text", "Icon"]) {
      expect(ids).toContain(helper);
    }
  });
});
