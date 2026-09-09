import { expect, test } from "bun:test";
import type { DomExtract, DomNode } from "@velloo/renderer";
import {
  childrenMeasuredAt,
  counterpartOf,
  measuredAt,
  styleDifferences,
  styleDiffForRegions,
} from "../computed.ts";

/**
 * Attributing browser-resolved styles to design nodes, and diffing them
 * against a captured page. The pixel diff says where two renders differ; this
 * is the half that says what differs there.
 */

let next = 0;
function node(over: Partial<DomNode> & { rect: DomNode["rect"] }): DomNode {
  return {
    i: next++,
    parent: null,
    depth: 1,
    tag: "div",
    style: {},
    ...over,
  } as DomNode;
}

function extract(nodes: DomNode[]): DomExtract {
  return {
    url: "about:blank",
    title: "",
    viewport: { w: 1440, h: 900 },
    documentHeight: 900,
    nodes,
    truncated: false,
  };
}

test("a design path resolves to the outermost element that carries it", () => {
  const dom = extract([
    node({ nodePath: "1.0", tag: "button", rect: { x: 0, y: 0, w: 200, h: 40 }, class: "btn" }),
    node({ nodePath: "1.0", tag: "span", rect: { x: 8, y: 8, w: 100, h: 24 } }),
  ]);
  const measured = measuredAt(dom, [1, 0]);
  expect(measured?.tag).toBe("button");
  expect(measured?.rect.h).toBe(40);
  expect(measuredAt(dom, [9])).toBeNull();
});

test("children are the design nodes one level down, not every descendant", () => {
  const dom = extract([
    node({ nodePath: "1", rect: { x: 0, y: 0, w: 400, h: 100 } }),
    node({ nodePath: "1.0", rect: { x: 0, y: 0, w: 400, h: 0 } }),
    node({ nodePath: "1.0.0", rect: { x: 0, y: 0, w: 40, h: 0 } }),
    node({ nodePath: "1.1", rect: { x: 0, y: 40, w: 400, h: 60 } }),
    node({ nodePath: "10", rect: { x: 0, y: 0, w: 10, h: 10 } }),
  ]);
  expect(childrenMeasuredAt(dom, [1]).map((c) => c.path)).toEqual(["1.0", "1.1"]);
});

test("root children are addressed without a leading separator", () => {
  const dom = extract([
    node({ nodePath: "", rect: { x: 0, y: 0, w: 400, h: 100 } }),
    node({ nodePath: "0", rect: { x: 0, y: 0, w: 400, h: 50 } }),
    node({ nodePath: "0.1", rect: { x: 0, y: 0, w: 400, h: 20 } }),
  ]);
  expect(childrenMeasuredAt(dom, []).map((c) => c.path)).toEqual(["0"]);
});

test("only the properties that disagree are reported, and a missing one counts", () => {
  const design = measuredAt(
    extract([
      node({
        nodePath: "0",
        rect: { x: 0, y: 0, w: 1, h: 1 },
        style: { padding: "16px", color: "rgb(0, 0, 0)" },
      }),
    ]),
    [0],
  );
  const page = measuredAt(
    extract([
      node({
        nodePath: "0",
        rect: { x: 0, y: 0, w: 1, h: 1 },
        style: { padding: "24px", color: "rgb(0, 0, 0)", height: "48px" },
      }),
    ]),
    [0],
  );
  if (!design || !page) throw new Error("fixture");
  expect(styleDifferences(design, page)).toEqual([
    { property: "padding", design: "16px", page: "24px" },
    { property: "height", design: "", page: "48px" },
  ]);
});

test("the counterpart is the page element occupying the same box, not one containing it", () => {
  const page = extract([
    // A full-page wrapper contains the rect but is not what sits there.
    node({ tag: "main", rect: { x: 0, y: 0, w: 1440, h: 3000 } }),
    node({ tag: "section", rect: { x: 100, y: 200, w: 300, h: 100 } }),
    // A small child inside the rect is not the counterpart either.
    node({ tag: "span", rect: { x: 110, y: 210, w: 20, h: 12 } }),
  ]);
  expect(counterpartOf(page, { x: 100, y: 200, w: 300, h: 100 })?.tag).toBe("section");
  // Nothing lines up: better to report nothing than to invent a pairing.
  expect(counterpartOf(page, { x: 900, y: 2500, w: 300, h: 100 })).toBeNull();
});

test("regions become a per-node diff in image-pixel space, deduped by node", () => {
  const design = extract([
    node({
      nodePath: "1.0",
      tag: "div",
      rect: { x: 100, y: 200, w: 300, h: 88 },
      style: { padding: "16px" },
    }),
  ]);
  const page = extract([
    node({ tag: "header", rect: { x: 100, y: 200, w: 300, h: 112 }, style: { padding: "24px" } }),
  ]);
  // scaleFactor 0.5: the regions are at half the CSS coordinates.
  const regions = [
    { x: 50, y: 100, w: 150, h: 44, node: { path: [1, 0], ref: "CardHeader" } },
    { x: 52, y: 102, w: 150, h: 44, node: { path: [1, 0], ref: "CardHeader" } },
  ];
  const diff = styleDiffForRegions(regions, design, page, 0.5);
  expect(diff).toHaveLength(1);
  expect(diff[0]?.node).toBe("CardHeader @[1,0]");
  expect(diff[0]?.size).toEqual({ design: "300×88", page: "300×112" });
  expect(diff[0]?.differs).toEqual([{ property: "padding", design: "16px", page: "24px" }]);
});

test("a region whose node has no counterpart contributes nothing rather than a guess", () => {
  const design = extract([node({ nodePath: "0", rect: { x: 0, y: 0, w: 100, h: 50 } })]);
  const page = extract([node({ tag: "div", rect: { x: 900, y: 900, w: 100, h: 50 } })]);
  expect(
    styleDiffForRegions([{ x: 0, y: 0, w: 100, h: 50, node: { path: [0] } }], design, page, 1),
  ).toEqual([]);
});
