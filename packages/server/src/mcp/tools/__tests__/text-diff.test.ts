import { expect, test } from "bun:test";
import type { DomExtract, DomNode } from "@velloo/renderer";
import { diffText } from "../text-diff.ts";

/**
 * The copy a design and its page disagree on. Each case is a way two renders
 * can hold the same words in a different shape — or different words in the
 * same shape — and the diff has to tell those apart.
 */

type Line = Partial<DomNode> & { text: string };

function extract(lines: Line[]): DomExtract {
  return {
    url: "about:blank",
    title: "",
    viewport: { w: 1440, h: 900 },
    documentHeight: 900,
    nodes: lines.map((line, i) => ({
      i,
      parent: null,
      depth: 1,
      tag: "p",
      style: {},
      rect: { x: 0, y: i * 40, w: 400, h: 24 },
      ...line,
    })),
    truncated: false,
  };
}

const label = (path: string) => `Text @[${path}]`;

test("two renders that say the same thing have no diff", () => {
  const page = extract([{ text: "Opening hours" }, { text: "Mon–Fri 9am–5pm" }]);
  const design = extract([{ text: "Mon–Fri 9am–5pm" }, { text: "Opening hours" }]);
  expect(diffText(design, page)).toBeNull();
});

test("a reworded line is reported once, as changed, against the node that drew it", () => {
  const page = extract([{ text: "Opening hours" }, { text: "Mon–Fri 9am–5pm" }]);
  const design = extract([
    { text: "Opening hours", nodePath: "0" },
    { text: "Mon–Fri 9am–6pm", nodePath: "1" },
  ]);
  expect(diffText(design, page, { label })).toEqual({
    changed: [{ page: "Mon–Fri 9am–5pm", design: "Mon–Fri 9am–6pm", node: "Text @[1]" }],
  });
});

test("text on one side only is missing or extra, not changed", () => {
  const page = extract([{ text: "Free delivery over £50" }, { text: "Shop now" }]);
  const design = extract([
    { text: "Shop now", nodePath: "0" },
    { text: "Lorem ipsum dolor", nodePath: "1", rect: { x: 600, y: 600, w: 100, h: 20 } },
  ]);
  expect(diffText(design, page, { label })).toEqual({
    missing: ["Free delivery over £50"],
    extra: [{ text: "Lorem ipsum dolor", node: "Text @[1]" }],
  });
});

test("unrelated lines filling the same box are one slot whose copy was replaced", () => {
  const rect = { x: 40, y: 300, w: 160, h: 40 };
  const page = extract([{ text: "Add to basket", rect }]);
  const design = extract([{ text: "Buy", rect, nodePath: "2.0" }]);
  expect(diffText(design, page, { label })?.changed).toEqual([
    { page: "Add to basket", design: "Buy", node: "Text @[2.0]" },
  ]);
});

test("the same words cut into different elements are not a difference", () => {
  // Own text only, as an older stored capture has it: the page's <strong> is a
  // separate run and no line on one side equals a line on the other.
  const page = extract([{ text: "Open to 5pm" }, { text: "9am", tag: "strong" }]);
  const design = extract([{ text: "Open 9am to 5pm" }]);
  expect(diffText(design, page)).toBeNull();
});

test("a line is read with its inline children, which are not counted again", () => {
  const page = extract([
    { text: "Open to 5pm", line: "Open 9am to 5pm", depth: 2 },
    { text: "9am", tag: "strong", depth: 3 },
    { text: "Closed Sundays", depth: 2 },
  ]);
  const design = extract([
    { text: "Open 9am to 6pm", nodePath: "0" },
    { text: "Closed Sundays", nodePath: "1" },
  ]);
  expect(diffText(design, page, { label })).toEqual({
    changed: [{ page: "Open 9am to 5pm", design: "Open 9am to 6pm", node: "Text @[0]" }],
  });
});

test("text-transform is part of what a line says", () => {
  const page = extract([{ text: "Shop now", style: { textTransform: "uppercase" } }]);
  expect(diffText(extract([{ text: "SHOP NOW" }]), page)).toBeNull();
  expect(diffText(extract([{ text: "Shop Now" }]), page)?.changed).toEqual([
    { page: "SHOP NOW", design: "Shop Now" },
  ]);
});

test("typographic variants and decoration are not copy", () => {
  const page = extract([{ text: "Don’t miss out — “new” in…" }, { text: "•" }, { text: "→" }]);
  const design = extract([{ text: `Don't miss out - "new" in...` }, { text: "|" }]);
  expect(diffText(design, page)).toBeNull();
});

test("a repeated line counts as often as it appears, and is listed once", () => {
  const page = extract([{ text: "Add to cart" }, { text: "Add to cart" }, { text: "Add to cart" }]);
  const design = extract([{ text: "Add to cart" }]);
  expect(diffText(design, page)).toEqual({ missing: ["Add to cart"] });
});

test("a text node is attributed to the nearest design node above it", () => {
  const design: DomExtract = extract([{ text: "wrapper", nodePath: "3" }, { text: "Was £20" }]);
  (design.nodes[1] as DomNode).parent = 0;
  expect(diffText(design, extract([{ text: "wrapper" }]), { label })?.extra).toEqual([
    { text: "Was £20", node: "Text @[3]" },
  ]);
});

test("a viewport comparison reads only the text that viewport holds", () => {
  const page = extract([
    { text: "Hero" },
    { text: "Footer", rect: { x: 0, y: 4000, w: 400, h: 24 } },
  ]);
  const design = extract([{ text: "Hero" }]);
  expect(diffText(design, page)).toEqual({ missing: ["Footer"] });
  expect(diffText(design, page, { clipHeight: 900 })).toBeNull();
});

test("long lists are capped and the remainder counted", () => {
  const shared = Array.from({ length: 40 }, (_, i) => ({ text: `shared${i} line${i}` }));
  const only = Array.from({ length: 20 }, (_, i) => ({ text: `unique${i} word${i}` }));
  const diff = diffText(extract(shared), extract([...shared, ...only]));
  expect(diff?.missing).toHaveLength(8);
  expect(diff?.omitted).toBe(12);
});

test("two renders that are not the same page are not a list of copy changes", () => {
  // A design that did not mount, or a page half-built: most lines differ, and
  // naming eight of three hundred helps nobody.
  const page = extract(Array.from({ length: 30 }, (_, i) => ({ text: `page${i} copy${i}` })));
  const design = extract(Array.from({ length: 30 }, (_, i) => ({ text: `<Frame${i}>` })));
  expect(diffText(design, page)).toBeNull();
  expect(diffText(extract([]), page)).toBeNull();
  // A short page whose every line changed is still a copy change.
  const short = extract([{ text: "Opening hours" }, { text: "Mon–Fri 9am–5pm" }]);
  expect(diffText(extract([]), short)?.missing).toHaveLength(2);
});
