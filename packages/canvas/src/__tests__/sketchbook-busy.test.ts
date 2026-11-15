import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SketchbookPending } from "@velloo/protocol";
import { SketchbookFileSchema } from "@velloo/schema";
import { useCanvas } from "../store.ts";

/**
 * One draw covers every picked direction, but the server ends each
 * direction's pending entry as that direction's images land. The canvas's
 * own busy marker must not outlive the server's, or the direction that
 * finished first shows another loading tile while the rest are drawn.
 */

const realFetch = globalThis.fetch;

const sketchbook = SketchbookFileSchema.parse({
  version: 1,
  stage: "mocks",
  brief: { origin: "new", product: "Trailhead", page: "the landing page" },
  directions: [
    { id: "a", title: "A", description: "a", picked: true, images: [] },
    { id: "b", title: "B", description: "b", picked: true, images: [] },
  ],
});

let pending: SketchbookPending[];
let finishDraw: () => void;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  pending = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/sketchbook/state")) {
      return json({ id: "sb1", sketchbook, pending, promptChars: {} });
    }
    if (url.includes("/api/sketchbook/generate")) {
      await new Promise<void>((resolve) => {
        finishDraw = resolve;
      });
      return json({ made: [], failed: [] });
    }
    if (url.includes("/api/sketchbook/models")) return json({ models: null });
    return json({});
  }) as typeof fetch;
  useCanvas.setState({ sketchbookId: "sb1", sketchbookBusy: [], sketchbookFailures: {} });
  await useCanvas.getState().refreshSketchbook();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a direction whose mocks landed stops loading while another is still drawn", async () => {
  const run = useCanvas.getState().generateSketchbook({ kind: "mock" });
  expect(useCanvas.getState().sketchbookBusy).toEqual(["mock:a", "mock:b"]);

  // The server tracks both directions as the draw starts.
  pending = [
    { direction: "a", kind: "mock", count: 2 },
    { direction: "b", kind: "mock", count: 2 },
  ];
  await useCanvas.getState().refreshSketchbook();
  expect(useCanvas.getState().sketchbookBusy).toEqual([]);

  // Direction a's two mocks land; b's second is still being drawn.
  pending = [{ direction: "b", kind: "mock", count: 2 }];
  await useCanvas.getState().refreshSketchbook();
  const state = useCanvas.getState();
  const busy = (d: string) =>
    state.sketchbookBusy.includes(`mock:${d}`) ||
    Boolean(state.sketchbook?.pending.some((p) => p.direction === d));
  expect(busy("a")).toBe(false);
  expect(busy("b")).toBe(true);

  pending = [];
  finishDraw();
  await run;
  expect(useCanvas.getState().sketchbookBusy).toEqual([]);
});

test("ending a draw the server already ended leaves other draws' markers alone", async () => {
  const run = useCanvas.getState().generateSketchbook({ kind: "mock", directions: ["a"] });
  pending = [{ direction: "a", kind: "mock", count: 1 }];
  await useCanvas.getState().refreshSketchbook();
  useCanvas.setState({ sketchbookBusy: ["moodboard:b"] });

  pending = [];
  finishDraw();
  await run;
  expect(useCanvas.getState().sketchbookBusy).toEqual(["moodboard:b"]);
});
