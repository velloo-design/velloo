import { describe, expect, test } from "bun:test";
import type { Screen, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../../design-folder.ts";
import { HistoryManager } from "../../history.ts";
import type { MutationContext } from "../index.ts";
import { propWarnings, propWarningsForTree } from "../prop-warnings.ts";

const provider = createShadcnProvider();

const screen: Screen = { id: "s", name: "S", tree: { $ref: "Card" } };

function ctxOf(): MutationContext {
  const folder: DesignFolder = {
    root: "/tmp",
    config: {
      schemaVersion: 1,
      toolVersion: "test",
      library: { id: "shadcn-react", version: "t", source: "binary", componentsPath: "binary" },
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    },
    theme: {
      name: "t",
      colors: {
        background: "#fff",
        foreground: "#000",
        primary: { DEFAULT: "#000", foreground: "#fff" },
      },
      typography: {},
      spacing: {},
      radius: {},
    } as Theme,
    history: new HistoryManager(),
    customCss: "",
    themes: new Map(),
    screens: new Map([[screen.id, screen]]),
    boards: new Map(),
    snippets: new Map(),
    annotations: new Map(),
    notes: new Map(),
  };
  return {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => {},
  };
}

describe("propWarnings", () => {
  test("flags a typo'd prop name with nearest-known suggestions", async () => {
    // The exact bug this exists for: Chart takes `kind`, not `type`.
    const w = await propWarnings(ctxOf(), screen, "Chart", { type: "bar" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain('unknown prop "type"');
    expect(w[0]).toContain("kind");
  });

  test("flags enum values outside the declared set", async () => {
    const w = await propWarnings(ctxOf(), screen, "Button", { variant: "danger" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain('"variant"');
    expect(w[0]).toContain("destructive");
  });

  test("accepts valid props, universal props, and data-/aria- passthroughs", async () => {
    const w = await propWarnings(ctxOf(), screen, "Button", {
      variant: "outline",
      className: "w-full",
      children: "Go",
      "data-testid": "cta",
      "aria-label": "Go",
    });
    expect(w).toEqual([]);
  });

  test("skips $param/$if substitution values (snippet bodies)", async () => {
    const w = await propWarnings(ctxOf(), screen, "Button", {
      variant: { $if: "highlighted", then: "default", else: "outline" },
    });
    expect(w).toEqual([]);
  });

  test("flags a removed lucide brand glyph with an SVG/Image hint, not a bogus match", async () => {
    const w = await propWarnings(ctxOf(), screen, "Icon", { name: "Github" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain('doesn\'t match any lucide icon — renders as the fallback "?"');
    expect(w[0]).toContain("brand glyphs");
    expect(w[0]).toContain("SVG");
    // Brand names skip the misleading nearest-match suggestion.
    expect(w[0]).not.toContain("closest:");
  });

  test("a plain typo'd icon name still suggests the closest real icon", async () => {
    const w = await propWarnings(ctxOf(), screen, "Icon", { name: "ArrowRiht" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain("closest:");
  });

  test("a valid lucide name (either case) produces no warning", async () => {
    expect(await propWarnings(ctxOf(), screen, "Icon", { name: "ArrowRight" })).toEqual([]);
    expect(await propWarnings(ctxOf(), screen, "Icon", { name: "arrow-right" })).toEqual([]);
  });

  test("tree walk prefixes warnings with the node path", async () => {
    const w = await propWarningsForTree(ctxOf(), screen, {
      $ref: "Card",
      children: [
        { $ref: "Button", props: { variant: "danger" } },
        { $ref: "Chart", props: { type: "bar" } },
      ],
    });
    expect(w.length).toBe(2);
    expect(w[0]).toStartWith("[0] ");
    expect(w[1]).toStartWith("[1] ");
  });
});
