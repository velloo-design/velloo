import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Board, FlowEdge } from "@velloo/schema";
import { createApp } from "../app.ts";
import { flowSpec } from "../flow.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { designBoard, type TestContext, testContext } from "../testing/design-folder.ts";

/**
 * Flow arrows as the canvas reaches them: over HTTP, on the undo stack, and
 * through a board file someone else may have written.
 */

const SCREENS = ["form", "sending", "verify"];
const frame = (screen: string) => `frame-${screen}`;

let t: TestContext;
let app: ReturnType<typeof createApp>;

async function open(boards: Record<string, Board>): Promise<void> {
  t = await testContext({
    label: "flow-routes",
    screens: Object.fromEntries(SCREENS.map((id) => [id, true as const])),
    boards,
  });
  const { ctx, root } = t;
  app = createApp(
    () => ctx,
    new TailwindJit(ctx.defaultProvider, join(root, "screens")),
    new LiveBundler(
      root,
      () => ctx.folder.config,
      () => liveExtensions(ctx.folder.config.extensions),
    ),
    new CanvasBundler(
      root,
      () => ctx.folder.config.hostApp,
      () => undefined,
    ),
  );
}

beforeEach(() => open({ signup: designBoard("signup", SCREENS) }));
afterEach(() => t.cleanup());

const post = (path: string, body?: unknown): Promise<Response> =>
  Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    ),
  );
const connect = (edges: unknown[]) =>
  post("/api/mutate/connect_frames", { boardId: "signup", edges });
const edgesOf = () => t.ctx.folder.boards.get("signup")?.edges;
const onDisk = async () => (await Bun.file(join(t.root, "boards/signup.json")).json()) as Board;

describe("POST /api/mutate/connect_frames", () => {
  test("draws an arrow and answers with the board's arrows", async () => {
    const res = await connect([{ from: frame("form"), to: frame("sending"), label: "Submit" }]);
    expect(res.status).toBe(200);
    const drawn: FlowEdge[] = [{ from: frame("form"), to: frame("sending"), label: "Submit" }];
    expect(await res.json()).toEqual({ edges: drawn });
    expect((await onDisk()).edges).toEqual(drawn);
  });

  test("the board the canvas then reads carries them", async () => {
    await connect([{ from: frame("form"), to: frame("sending"), state: "loading" }]);
    const res = await app.fetch(new Request("http://localhost/api/board/signup"));
    expect(((await res.json()) as Board).edges).toEqual([
      { from: frame("form"), to: frame("sending"), state: "loading" },
    ]);
  });

  test("a misspelled field is refused, not dropped", async () => {
    const res = await connect([{ from: frame("form"), to: frame("sending"), lable: "Submit" }]);
    expect(res.status).toBe(400);
    expect(edgesOf()).toBeUndefined();
  });

  test("a refusal is a 400 that says why", async () => {
    const res = await connect([{ from: frame("form"), to: frame("form") }]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("can't point at itself");
  });

  test("an unknown frame is a 404 naming it", async () => {
    const res = await connect([{ from: frame("form"), to: "nowhere" }]);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).toContain("nowhere");
  });
});

describe("arrows on the undo stack", () => {
  test("drawing one is a step: undo takes it away, redo brings it back", async () => {
    await connect([{ from: frame("form"), to: frame("sending"), label: "Submit" }]);
    expect(t.ctx.folder.history.depths().undo).toBe(1);

    expect((await post("/api/undo")).status).toBe(200);
    expect(edgesOf()).toBeUndefined();
    expect(await onDisk()).not.toHaveProperty("edges");

    expect((await post("/api/undo/redo")).status).toBe(200);
    expect(edgesOf()).toEqual([{ from: frame("form"), to: frame("sending"), label: "Submit" }]);
  });

  test("undoing a removed frame brings its arrows back with it", async () => {
    await connect([
      { from: frame("form"), to: frame("sending"), state: "loading" },
      { from: frame("sending"), to: frame("verify") },
    ]);
    // Two writes to one board inside the coalescing window are one step, so
    // age the first: these are two gestures, not one.
    const history = t.ctx.folder.history;
    const drawn = history.popUndo();
    if (drawn) history.pushUndoSilent({ ...drawn, ts: Date.now() - 60_000 });
    await post("/api/mutate/remove_frame", { boardId: "signup", frameId: frame("sending") });
    expect(edgesOf()).toBeUndefined();

    await post("/api/undo");
    expect(t.ctx.folder.boards.get("signup")?.frames).toHaveLength(3);
    expect(edgesOf()).toHaveLength(2);
  });
});

describe("a board file someone else wrote", () => {
  const stale: FlowEdge[] = [
    { from: frame("form"), to: frame("sending"), state: "loading" },
    { from: frame("form"), to: "deleted-long-ago", label: "Skip" },
    // Not a shape a writer would produce: a second state arrow into one frame.
    { from: frame("verify"), to: frame("sending"), state: "error" },
  ];

  beforeEach(async () => {
    await t.cleanup();
    await open({ signup: designBoard("signup", SCREENS, { edges: stale }) });
  });

  test("loads as written", () => {
    expect(edgesOf()).toEqual(stale);
  });

  test("reads as the flow it can be: the dangling arrow is skipped, the stray state is a transition", () => {
    const flow = flowSpec(t.ctx.folder, t.ctx.folder.boards.get("signup") as Board);
    expect(flow.steps.map((step) => step.frame)).toEqual([frame("form"), frame("verify")]);
    expect(flow.steps[0]?.states).toEqual([
      { state: "loading", frame: frame("sending"), screen: "sending" },
    ]);
    expect(flow.transitions).toEqual([{ from: frame("verify"), to: frame("sending") }]);
  });

  test("the next write to the board drops the dangling arrow", async () => {
    await post("/api/mutate/update_frame", {
      boardId: "signup",
      patches: [{ frameId: frame("form"), patch: { x: 40 } }],
    });
    expect((await onDisk()).edges).toEqual([stale[0], stale[2]] as FlowEdge[]);
  });

  test("editing its arrows is refused until the stray state arrow is fixed, and fixing it is one call", async () => {
    const refused = await connect([{ from: frame("form"), to: frame("verify"), label: "Skip" }]);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("one state of one step");

    const fixed = await connect([
      { from: frame("verify"), to: frame("sending"), remove: true },
      { from: frame("form"), to: frame("verify"), label: "Skip" },
    ]);
    expect(fixed.status).toBe(200);
    expect(edgesOf()).toEqual([
      { from: frame("form"), to: frame("sending"), state: "loading" },
      { from: frame("form"), to: frame("verify"), label: "Skip" },
    ]);
  });
});
