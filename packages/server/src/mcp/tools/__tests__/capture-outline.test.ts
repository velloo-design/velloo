import { describe, expect, test } from "bun:test";
import type { DomExtract, DomNode } from "@velloo/renderer";
import { outlineOf } from "../captures.ts";

function node(i: number, over: Partial<DomNode> = {}): DomNode {
  return {
    i,
    parent: null,
    depth: 0,
    tag: "div",
    rect: { x: 0, y: 0, w: 100, h: 40 },
    style: {},
    ...over,
  };
}

function extract(nodes: DomNode[], viewportW = 1280): DomExtract {
  return {
    url: "https://example.test/",
    title: "Example",
    viewport: { w: viewportW, h: 900 },
    documentHeight: 4000,
    nodes,
    truncated: false,
  };
}

describe("outlineOf", () => {
  test("carries position, not just size", () => {
    // A pill floating over a carousel and a caption in flow have the same box.
    // Only the coordinates tell them apart, which is why sizes alone mislead.
    const dom = extract([
      node(0, {
        tag: "span",
        text: "Life on India's west coast",
        rect: { x: 819, y: 909, w: 163, h: 40 },
      }),
    ]);
    expect(outlineOf(dom).lines[0]).toBe(`span "Life on India's west coast" [163×40 @819,909]`);
  });

  test("flags a transparent node and everything under it", () => {
    // The reported failure: a hover-only quiz whose children read as page copy.
    const dom = extract([
      node(0, { tag: "section", style: { opacity: "0" } }),
      node(1, { parent: 0, depth: 1, tag: "h2", text: "Quiz of the day" }),
      node(2, { parent: 1, depth: 2, tag: "span", text: "Which city is this?" }),
      node(3, { tag: "footer", text: "Visible footer" }),
    ]);
    const lines = outlineOf(dom).lines;
    expect(lines[0]).toContain("HIDDEN(opacity:0)");
    // Opacity does not inherit as a computed style, so the descendants would
    // otherwise look like ordinary content.
    expect(lines[1]).toContain("HIDDEN");
    expect(lines[1]).not.toContain("opacity:0");
    expect(lines[2]).toContain("HIDDEN");
    expect(lines[3]).not.toContain("HIDDEN");
  });

  test("a non-zero opacity under a hidden parent still reads as inherited, not as its own cause", () => {
    const dom = extract([
      node(0, { tag: "section", style: { opacity: "0" } }),
      node(1, { parent: 0, depth: 1, tag: "p", text: "faded child", style: { opacity: "0.9" } }),
    ]);
    expect(outlineOf(dom).lines[1]).toContain("HIDDEN");
    expect(outlineOf(dom).lines[1]).not.toContain("opacity:0");
  });

  test("flags rects outside the captured page box", () => {
    const dom = extract([
      node(0, { tag: "nav", text: "Skip to content", rect: { x: -9999, y: 0, w: 100, h: 20 } }),
      node(1, { tag: "aside", text: "Off-stage slide", rect: { x: 1400, y: 200, w: 300, h: 200 } }),
      node(2, { tag: "main", text: "On screen", rect: { x: 0, y: 0, w: 1280, h: 400 } }),
    ]);
    const lines = outlineOf(dom).lines;
    expect(lines[0]).toContain("OFFSCREEN");
    expect(lines[1]).toContain("OFFSCREEN");
    expect(lines[2]).not.toContain("OFFSCREEN");
  });

  test("reports how much of the tree the digest actually shows", () => {
    const nodes = Array.from({ length: 80 }, (_, i) => node(i, { tag: "section" }));
    const outline = outlineOf(extract(nodes), 60);
    expect(outline.shown).toBe(60);
    expect(outline.lines).toHaveLength(60);
  });

  test("counts invisible nodes even when they fall past the line limit", () => {
    const nodes = [
      ...Array.from({ length: 60 }, (_, i) => node(i, { tag: "section" })),
      node(60, { tag: "section", style: { opacity: "0" } }),
    ];
    const outline = outlineOf(extract(nodes), 60);
    expect(outline.shown).toBe(60);
    expect(outline.hiddenCount).toBe(1);
  });

  test("samples long documents spatially instead of stopping above the fold", () => {
    const nodes = Array.from({ length: 100 }, (_, i) =>
      node(i, {
        tag: "section",
        text: `Section ${i}`,
        rect: { x: 0, y: i * 100, w: 1280, h: 80 },
      }),
    );
    const dom = { ...extract(nodes), documentHeight: 10_000 };
    const outline = outlineOf(dom, 20);
    expect(outline.lines.some((line) => line.includes("Section 90"))).toBe(true);
    expect(outline.coverage.toY).toBeGreaterThan(9_000);
  });
});
