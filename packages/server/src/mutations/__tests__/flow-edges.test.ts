import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Board } from "@velloo/schema";
import { designBoard, testContext } from "../../testing/design-folder.ts";
import {
  connectFrames,
  type MutationContext,
  moveFrame,
  removeFrame,
  removeScreen,
} from "../index.ts";

let folder: Awaited<ReturnType<typeof testContext>>;
let ctx: MutationContext;

const SCREENS = ["form", "sending", "taken", "verify"];
const frame = (screen: string) => `frame-${screen}`;

beforeEach(async () => {
  folder = await testContext({
    label: "flow-edges",
    screens: Object.fromEntries(SCREENS.map((id) => [id, true as const])),
    boards: { signup: designBoard("signup", SCREENS), other: designBoard("other", []) },
  });
  ctx = folder.ctx;
});

afterEach(() => folder.cleanup());

const onDisk = async (boardId = "signup") =>
  (await Bun.file(join(folder.root, `boards/${boardId}.json`)).json()) as Board;

describe("connect_frames", () => {
  test("draws arrows, persists them, and broadcasts the board", async () => {
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [
          { from: frame("form"), to: frame("sending"), state: "loading", label: "Submit" },
          { from: frame("sending"), to: frame("verify"), label: "Account created" },
        ],
      }),
    );
    expect(result.edges).toEqual([
      { from: frame("form"), to: frame("sending"), label: "Submit", state: "loading" },
      { from: frame("sending"), to: frame("verify"), label: "Account created" },
    ]);
    expect((await onDisk()).edges).toEqual(result.edges);
    expect(folder.events).toContainEqual({ type: "board-changed", boardId: "signup" });
  });

  test("the same pair again edits the arrow; null clears, omitted is unchanged", async () => {
    const pair = { from: frame("form"), to: frame("sending") };
    unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [{ ...pair, state: "loading", label: "Submit" }],
      }),
    );
    const relabelled = unwrap(
      await connectFrames(ctx, { boardId: "signup", edges: [{ ...pair, label: "Send" }] }),
    );
    expect(relabelled.edges).toEqual([{ ...pair, label: "Send", state: "loading" }]);

    const transition = unwrap(
      await connectFrames(ctx, { boardId: "signup", edges: [{ ...pair, state: null }] }),
    );
    expect(transition.edges).toEqual([{ ...pair, label: "Send" }]);

    const bare = unwrap(
      await connectFrames(ctx, { boardId: "signup", edges: [{ ...pair, label: "  " }] }),
    );
    expect(bare.edges).toEqual([pair]);
  });

  test("state names are trimmed and lower-cased", async () => {
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [{ from: frame("form"), to: frame("taken"), state: " Error " }],
      }),
    );
    expect(result.edges[0]?.state).toBe("error");
  });

  test("removing the last arrow drops the field from the file", async () => {
    const pair = { from: frame("form"), to: frame("verify") };
    unwrap(await connectFrames(ctx, { boardId: "signup", edges: [pair] }));
    const result = unwrap(
      await connectFrames(ctx, { boardId: "signup", edges: [{ ...pair, remove: true }] }),
    );
    expect(result.edges).toEqual([]);
    expect(await onDisk()).not.toHaveProperty("edges");
  });

  test("one call can re-point a state without tripping on the way", async () => {
    unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [{ from: frame("form"), to: frame("taken"), state: "error" }],
      }),
    );
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [
          { from: frame("sending"), to: frame("taken"), state: "error" },
          { from: frame("form"), to: frame("taken"), remove: true },
        ],
      }),
    );
    expect(result.edges).toEqual([{ from: frame("sending"), to: frame("taken"), state: "error" }]);
  });

  test("a state arrow into a frame that is already that state of the step is kept as a transition", async () => {
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [
          { from: frame("form"), to: frame("sending"), state: "loading", label: "Submit" },
          { from: frame("sending"), to: frame("taken"), state: "error", label: "Email taken" },
          { from: frame("taken"), to: frame("sending"), state: "loading", label: "Try again" },
        ],
      }),
    );
    expect(result.edges.at(-1)).toEqual({
      from: frame("taken"),
      to: frame("sending"),
      label: "Try again",
    });
    expect(result.readAsTransitions).toEqual([
      { from: frame("taken"), to: frame("sending"), state: "loading" },
    ]);
    expect((await onDisk()).edges).toEqual(result.edges);
  });

  test("a way back to the form, drawn as a state, is kept as a transition", async () => {
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [
          { from: frame("form"), to: frame("taken"), state: "error", label: "Email taken" },
          { from: frame("taken"), to: frame("form"), state: "recovery", label: "Edit the email" },
          { from: frame("verify"), to: frame("form"), state: "default", label: "Start over" },
        ],
      }),
    );
    expect(result.edges).toEqual([
      { from: frame("form"), to: frame("taken"), label: "Email taken", state: "error" },
      { from: frame("taken"), to: frame("form"), label: "Edit the email" },
      { from: frame("verify"), to: frame("form"), label: "Start over" },
    ]);
    expect(result.readAsTransitions).toEqual([
      { from: frame("taken"), to: frame("form"), state: "recovery" },
      { from: frame("verify"), to: frame("form"), state: "default" },
    ]);
  });

  test("an ordinary write names nothing as read differently", async () => {
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [{ from: frame("form"), to: frame("sending"), state: "loading" }],
      }),
    );
    expect(result).not.toHaveProperty("readAsTransitions");
  });

  test("refuses what can't be a flow, and writes nothing", async () => {
    const refused = async (edges: Parameters<typeof connectFrames>[1]["edges"]) => {
      const result = await connectFrames(ctx, { boardId: "signup", edges });
      if (result.ok) throw new Error("expected a refusal");
      return JSON.stringify(result.error);
    };
    expect(await refused([{ from: frame("form"), to: "nope" }])).toContain("FrameNotFound");
    expect(await refused([{ from: frame("form"), to: frame("form") }])).toContain("itself");
    expect(await refused([{ from: frame("form"), to: frame("verify"), remove: true }])).toContain(
      "No arrow",
    );
    expect(
      await refused([
        { from: frame("form"), to: frame("taken"), state: "error" },
        { from: frame("sending"), to: frame("taken"), state: "empty" },
      ]),
    ).toContain("one state of one step");
    // The same state, claimed by a frame of another step.
    expect(
      await refused([
        { from: frame("form"), to: frame("sending"), state: "loading" },
        { from: frame("verify"), to: frame("sending"), state: "loading" },
      ]),
    ).toContain("one state of one step");
    expect(
      await refused([{ from: frame("form"), to: frame("verify"), label: "x".repeat(121) }]),
    ).toContain("too long");
    expect(
      await refused([{ from: frame("form"), to: frame("taken"), state: "x".repeat(33) }]),
    ).toContain("state name too long");
    expect(await onDisk()).not.toHaveProperty("edges");
  });

  test("a blank state is no state", async () => {
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [{ from: frame("form"), to: frame("taken"), state: "  " }],
      }),
    );
    expect(result.edges).toEqual([{ from: frame("form"), to: frame("taken") }]);
  });

  test("an arrow each way between two frames is two arrows", async () => {
    const result = unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [
          { from: frame("form"), to: frame("verify"), label: "Continue" },
          { from: frame("verify"), to: frame("form"), label: "Back" },
        ],
      }),
    );
    expect(result.edges).toHaveLength(2);
  });

  test("an unknown board is BoardNotFound", async () => {
    const result = await connectFrames(ctx, { boardId: "nope", edges: [{ from: "a", to: "b" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BoardNotFound");
  });
});

describe("arrows follow their frames", () => {
  beforeEach(async () => {
    unwrap(
      await connectFrames(ctx, {
        boardId: "signup",
        edges: [
          { from: frame("form"), to: frame("sending"), state: "loading" },
          { from: frame("sending"), to: frame("taken"), state: "error" },
          { from: frame("sending"), to: frame("verify") },
        ],
      }),
    );
  });

  test("removing a frame removes the arrows that touched it", async () => {
    unwrap(await removeFrame(ctx, { boardId: "signup", frameId: frame("taken") }));
    expect((await onDisk()).edges).toEqual([
      { from: frame("form"), to: frame("sending"), state: "loading" },
      { from: frame("sending"), to: frame("verify") },
    ]);
  });

  test("deleting a screen takes its frames' arrows on every board", async () => {
    unwrap(await removeScreen(ctx, { screenId: "sending" }));
    expect(await onDisk()).not.toHaveProperty("edges");
  });

  test("a frame moved to another board leaves its arrows behind", async () => {
    unwrap(
      await moveFrame(ctx, { boardId: "signup", frameId: frame("verify"), toBoardId: "other" }),
    );
    expect((await onDisk()).edges).toEqual([
      { from: frame("form"), to: frame("sending"), state: "loading" },
      { from: frame("sending"), to: frame("taken"), state: "error" },
    ]);
    expect(await onDisk("other")).not.toHaveProperty("edges");
  });
});
