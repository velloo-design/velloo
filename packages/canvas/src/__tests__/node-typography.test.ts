import { describe, expect, test } from "bun:test";
import type { Node, Theme } from "@velloo/schema";
import { nodeRung, nodeTypography, overriddenProperty, typesetRegion } from "../node-typography.ts";

/**
 * The readout's whole value is that it agrees with what the browser renders. So
 * these pin the two places it could quietly lie: which rung a node lands on, and
 * which of the node's own utilities actually beat that rung.
 */

const theme = {
  name: "ember",
  colors: { background: "oklch(1 0 0)", foreground: "oklch(0.1 0 0)" },
  typography: {
    fontFamily: {
      sans: '"Inter", ui-sans-serif, sans-serif',
      display: '"Fraunces", ui-serif, Georgia, serif',
      mono: "ui-monospace, monospace",
    },
    typesets: {
      default: { leading: 1.5, fontBody: "sans", fontHeading: "display", fontMono: "mono" },
      compact: { size: 14, leading: 1.45 },
    },
  },
  spacing: {},
  radius: {},
} as unknown as Theme;

function facts(node: Node, tree: Node = node, path: number[] = []) {
  const resolved = nodeTypography(theme, tree, path, node);
  if (!resolved) throw new Error("expected typography facts");
  return resolved;
}

describe("rung", () => {
  test("a heading's level picks the ladder rung", () => {
    expect(facts({ $ref: "Heading", props: { level: 2 } }).role).toBe("h2");
  });

  // A Heading with no level renders an h1, and the prop dropdown shows empty —
  // which is exactly the confusion the readout has to clear up.
  test("an absent level is an h1, and says it is defaulted", () => {
    const f = facts({ $ref: "Heading" });
    expect(f.role).toBe("h1");
    expect(f.via).toContain("default");
  });

  test("a text variant maps to its copy rung", () => {
    expect(facts({ $ref: "Text", props: { variant: "muted" } }).role).toBe("caption");
    expect(facts({ $ref: "Text" }).role).toBe("body");
  });

  test("a node with no place on the ladder gets no readout", () => {
    expect(nodeTypography(theme, { $ref: "Box" }, [], { $ref: "Box" })).toBeNull();
  });

  test("the rung suffix labels headings only", () => {
    expect(nodeRung({ $ref: "Heading", props: { level: 3 } })).toBe("h3");
    expect(nodeRung({ $ref: "Text" })).toBeNull();
  });
});

describe("resolved values", () => {
  test("the rung resolves against the typeset's own controls", () => {
    const f = facts({ $ref: "Heading", props: { level: 1 } });
    // 16px base x the h1 ratio, and the theme's 1.5 leading x the h1 ratio.
    expect(f.resolved.fontSize).toBe(40);
    expect(f.resolved.lineHeight).toBeCloseTo(0.945, 3);
  });

  test("a heading takes the heading face, body copy takes the body face", () => {
    expect(facts({ $ref: "Heading", props: { level: 2 } }).face).toMatchObject({
      slot: "heading",
      role: "display",
    });
    expect(facts({ $ref: "Text" }).face).toMatchObject({ slot: "body", role: "sans" });
  });

  // A preset authors only what it changes, so the region's numbers have to come
  // from the preset composed over the baseline — not the preset alone.
  test("a typeset region re-resolves the rung through its preset", () => {
    const tree: Node = {
      $ref: "Prose",
      props: { preset: "compact" },
      children: [{ $ref: "Heading", props: { level: 1 } }],
    };
    const f = facts(tree.children?.[0] as Node, tree, [0]);
    expect(f.region).toEqual({ name: "compact", via: "prose" });
    expect(f.resolved.fontSize).toBe(35);
    expect(f.resolved.lineHeight).toBeCloseTo(0.914, 3);
    // fontHeading is not authored by `compact`, so it still inherits.
    expect(f.face.role).toBe("display");
  });
});

describe("typesetRegion", () => {
  test("a bare typeset- class on an ancestor counts", () => {
    const tree: Node = {
      $ref: "Box",
      props: { className: "typeset typeset-docs" },
      children: [{ $ref: "Box", children: [{ $ref: "Text" }] }],
    };
    expect(typesetRegion(tree, [0, 0])).toEqual({ name: "docs", via: "class" });
  });

  test("the nearest region wins over an outer one", () => {
    const tree: Node = {
      $ref: "Prose",
      props: { preset: "docs" },
      children: [{ $ref: "Prose", props: { preset: "compact" }, children: [{ $ref: "Text" }] }],
    };
    expect(typesetRegion(tree, [0, 0])).toEqual({ name: "compact", via: "prose" });
  });

  test("no wrapper means the folder baseline", () => {
    expect(typesetRegion({ $ref: "Box", children: [{ $ref: "Text" }] }, [0])).toBeNull();
  });
});

describe("overrides", () => {
  const roles = new Set(["sans", "display", "mono"]);

  // `text-` and `font-` are both overloaded. Reporting a colour as a size, or a
  // family as a weight, would make the readout worse than nothing.
  test("text- is a size only when its value is one", () => {
    expect(overriddenProperty("text-5xl", roles)).toBe("size");
    expect(overriddenProperty("text-[15px]", roles)).toBe("size");
    expect(overriddenProperty("text-cream/75", roles)).toBeNull();
    expect(overriddenProperty("text-muted-foreground", roles)).toBeNull();
  });

  test("font- splits into weight and family by what the theme declares", () => {
    expect(overriddenProperty("font-light", roles)).toBe("weight");
    expect(overriddenProperty("font-display", roles)).toBe("family");
    expect(overriddenProperty("font-[oops]", roles)).toBeNull();
  });

  test("the node's own utilities are reported against the rung they displace", () => {
    const f = facts({
      $ref: "Heading",
      props: {
        level: 1,
        className: "font-display text-5xl font-light leading-[1.06] tracking-tight text-cream",
      },
    });
    expect(f.overrides).toEqual({
      size: "text-5xl",
      weight: "font-light",
      leading: "leading-[1.06]",
      tracking: "tracking-tight",
      family: "font-display",
    });
    // The ladder value is still resolved — the row shows what was displaced.
    expect(f.resolved.fontSize).toBe(40);
  });

  test("a variant-prefixed utility is conditional, so it is listed apart", () => {
    const f = facts({
      $ref: "Heading",
      props: { level: 2, className: "text-4xl md:text-5xl" },
    });
    expect(f.overrides.size).toBe("text-4xl");
    expect(f.responsive).toEqual(["md:text-5xl"]);
  });
});
