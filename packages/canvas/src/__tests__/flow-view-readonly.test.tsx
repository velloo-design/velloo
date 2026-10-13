import { expect, test } from "bun:test";
import type { FlowEdge } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, text } from "./dom.ts";

/**
 * A board's arrows where nothing edits them. `FlowView` is given no label
 * renderer and no pick handler by a viewer that only shows a board — the share
 * page draws flows with this same component — so what it does on its own is
 * that reader's whole experience: every arrow that says something says it,
 * and nothing on the board pretends to be editable.
 */

const { FlowView } = await import("../components/flow-view.tsx");

const frames = [
  { id: "form", screen: "form", x: 0, y: 0, w: 400, h: 300 },
  { id: "sending", screen: "sending", x: 600, y: 0, w: 400, h: 300 },
  { id: "verify", screen: "verify", x: 1200, y: 0, w: 400, h: 300 },
  { id: "error", screen: "error", x: 600, y: 500, w: 400, h: 300 },
];
const insets = Object.fromEntries(frames.map((frame) => [frame.id, { x: 0, y: 20 }]));

const edges: FlowEdge[] = [
  { from: "form", to: "sending", state: "loading", label: "Submit" },
  { from: "sending", to: "verify" },
  { from: "form", to: "error", state: "error" },
];

const view = (shown: FlowEdge[] | undefined) =>
  mount(
    <div>
      <FlowView frames={frames} insets={insets} zoom={1} edges={shown} />
    </div>,
  );

const labels = () => $$("[data-flow-label]").map((el) => text(el));

domSuite("a flow that is only shown", () => {
  test("an arrow's state and label are written beside it; a bare arrow has nothing to say", async () => {
    const { unmount } = await view(edges);
    try {
      expect($$("[data-flow-edge]")).toHaveLength(3);
      expect(labels().sort()).toEqual(["error", "loadingSubmit"]);
    } finally {
      await unmount();
    }
  });

  test("nothing about it can be operated", async () => {
    const { host, unmount } = await view(edges);
    try {
      expect(host.querySelectorAll("button, input, [role='button'], [tabindex]")).toHaveLength(0);
      for (const hit of $$("[data-flow-hit]")) expect(hit.style.cursor).toBe("");
    } finally {
      await unmount();
    }
  });

  test("pointing at an arrow brings its own label forward, which is how the two are matched", async () => {
    const { unmount } = await view(edges);
    try {
      const arrow = $$("[data-flow-edge]").find(
        (el) => el.getAttribute("data-flow-state") === "loading",
      ) as HTMLElement;
      const key = arrow.getAttribute("data-flow-edge");
      const forward = () =>
        $$("[data-flow-label][data-flow-near]").map((el) => el.getAttribute("data-flow-label"));
      expect(forward()).toEqual([]);

      const hit = arrow.querySelector("[data-flow-hit]") as Element;
      await interact(() => {
        hit.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true }));
      });
      expect(forward()).toEqual([key]);

      await interact(() => {
        hit.dispatchEvent(
          new window.PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
        );
      });
      expect(forward()).toEqual([]);
    } finally {
      await unmount();
    }
  });

  test("a board with no arrows draws no layer at all", async () => {
    for (const none of [undefined, []]) {
      const { host, unmount } = await view(none);
      try {
        expect($("[data-flow-layer]")).toBeNull();
        expect(host.firstElementChild?.innerHTML).toBe("");
      } finally {
        await unmount();
      }
    }
  });

  test("an arrow to a frame that is no longer on the board is not drawn", async () => {
    const { unmount } = await view([...edges, { from: "verify", to: "gone", label: "Next" }]);
    try {
      expect($$("[data-flow-edge]")).toHaveLength(3);
      expect(labels()).not.toContain("Next");
    } finally {
      await unmount();
    }
  });
});
