import { expect, test } from "bun:test";
import type { CanvasState } from "../store.ts";
import { domSuite, mount } from "./dom.ts";
import { frameId } from "./fake-server.ts";

/**
 * The selection box and its resize grips are parent-side chrome anchored to a
 * box only the iframe can measure, so they exist exactly when a rect for the
 * selection came back.
 *
 * Two things this pins. Editing a snippet in place moves the selection into the
 * definition's namespace (`snippet:<id>`), which no frame's `screen` ever
 * equals — the lookup matched nothing and the grips silently never drew. And a
 * definition renders once per instance: every instance shows a box (that is the
 * scope of the edit), but only the one that was clicked carries grips.
 */

const { useCanvas } = await import("../store.ts");
const { SelectionLayer } = await import("../components/hud/SelectionLayer.tsx");

const FRAME = frameId("main");
const OTHER = frameId("main", 1);
const box = (y: number) => ({ x: 10, y, w: 120, h: 40 });

function seed(over: Partial<CanvasState> = {}): void {
  useCanvas.setState({
    canvasZoom: 1,
    cursorMode: "select",
    wsConnected: true,
    currentBoardId: "main",
    nodeRects: {},
    snippetRects: {},
    frameInsets: {
      [FRAME]: { x: 0, y: 40, chromeH: 60 },
      [OTHER]: { x: 0, y: 40, chromeH: 60 },
    },
    selection: null,
    snippetFocus: null,
    selectionAnchor: null,
    boards: {
      main: {
        id: "main",
        name: "main",
        frames: [
          { id: FRAME, screen: "home", x: 200, y: 100, w: 400, h: 300 },
          { id: OTHER, screen: "home", x: 700, y: 100, w: 400, h: 300 },
        ],
      },
    } as never,
    screens: {
      home: { id: "home", name: "home", tree: { $ref: "Box", children: [{ $ref: "Text" }] } },
      "snippet:card": {
        id: "snippet:card",
        name: "card",
        tree: { $ref: "Box", children: [{ $ref: "Text" }] },
      },
    } as never,
    ...over,
  });
}

/**
 * Every mounted layer subscribes to the same store, so one left behind
 * re-renders on the next test's seed and doubles the counts. Mount, count,
 * unmount.
 */
async function render(state: Partial<CanvasState>): Promise<{ boxes: number; grips: number }> {
  seed(state);
  const view = await mount(<SelectionLayer />);
  const counts = {
    boxes: view.host.querySelectorAll("[data-velloo-selection-box]").length,
    grips: view.host.querySelectorAll('button[aria-label^="Resize"]').length,
  };
  await view.unmount();
  return counts;
}

domSuite("selection chrome", () => {
  test("a plain node selection draws its box and the eight grips", async () => {
    expect(
      await render({
        selection: { screenId: "home", path: "0" },
        nodeRects: { [FRAME]: { "0": box(0) } },
      }),
    ).toEqual({ boxes: 1, grips: 8 });
  });

  test("a snippet selection draws chrome too — the rect is in the snippet namespace", async () => {
    expect(
      await render({
        snippetFocus: "card",
        selection: { screenId: "snippet:card", path: "0" },
        snippetRects: { [FRAME]: { "0": [box(0)] } },
      }),
    ).toEqual({ boxes: 1, grips: 8 });
  });

  test("every instance shows a box; only the clicked one carries grips", async () => {
    expect(
      await render({
        snippetFocus: "card",
        selection: { screenId: "snippet:card", path: "0" },
        snippetRects: { [FRAME]: { "0": [box(0), box(80), box(160)] } },
        selectionAnchor: { frameId: FRAME, instance: 1 },
      }),
    ).toEqual({ boxes: 3, grips: 8 });
  });

  test("the anchor is per frame, so the same index elsewhere doesn't take the grips", async () => {
    expect(
      await render({
        snippetFocus: "card",
        selection: { screenId: "snippet:card", path: "0" },
        snippetRects: { [FRAME]: { "0": [box(0)] }, [OTHER]: { "0": [box(0)] } },
        selectionAnchor: { frameId: OTHER, instance: 0 },
      }),
    ).toEqual({ boxes: 2, grips: 8 });
  });

  test("with no anchor — a tree or search selection — the first instance takes them", async () => {
    expect(
      await render({
        snippetFocus: "card",
        selection: { screenId: "snippet:card", path: "0" },
        snippetRects: { [FRAME]: { "0": [box(0), box(80)] }, [OTHER]: { "0": [box(0)] } },
        selectionAnchor: null,
      }),
    ).toEqual({ boxes: 3, grips: 8 });
  });

  test("the two namespaces never borrow each other's box for the same path", async () => {
    // "0" is a legal path in both trees; a snippet selection must not fall back
    // to the host tree's rect for it.
    expect(
      await render({
        snippetFocus: "card",
        selection: { screenId: "snippet:card", path: "0" },
        nodeRects: { [FRAME]: { "0": box(0) } },
        snippetRects: {},
      }),
    ).toEqual({ boxes: 0, grips: 0 });
  });

  test("leaving snippet focus stops using the snippet rects", async () => {
    expect(
      await render({
        snippetFocus: null,
        selection: { screenId: "snippet:card", path: "0" },
        snippetRects: { [FRAME]: { "0": [box(0)] } },
      }),
    ).toEqual({ boxes: 0, grips: 0 });
  });
});
