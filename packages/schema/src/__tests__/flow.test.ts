import { describe, expect, test } from "bun:test";
import {
  BoardSchema,
  deriveFlowSteps,
  type FlowEdge,
  flowEdgeProblem,
  liveFlowEdges,
  transitionsDrawnAsStates,
} from "../index.ts";

const frames = (...ids: string[]) => ids.map((id) => ({ id }));

describe("Board.edges", () => {
  const board = { id: "signup", name: "Sign up" };

  test("a board without arrows parses without the field", () => {
    const parsed = BoardSchema.parse(board);
    expect("edges" in parsed).toBe(false);
  });

  test("an arrow needs both ends; label and state are optional", () => {
    expect(BoardSchema.safeParse({ ...board, edges: [{ from: "a", to: "b" }] }).success).toBe(true);
    expect(
      BoardSchema.safeParse({
        ...board,
        edges: [{ from: "a", to: "b", label: "Submit", state: "error" }],
      }).success,
    ).toBe(true);
    expect(BoardSchema.safeParse({ ...board, edges: [{ from: "a" }] }).success).toBe(false);
    // A label's place along its arrow is a fraction of the way.
    expect(
      BoardSchema.safeParse({ ...board, edges: [{ from: "a", to: "b", labelAt: 0.25 }] }).success,
    ).toBe(true);
    expect(
      BoardSchema.safeParse({ ...board, edges: [{ from: "a", to: "b", labelAt: 1.5 }] }).success,
    ).toBe(false);
    expect(BoardSchema.safeParse({ ...board, edges: [{ from: "a", to: "" }] }).success).toBe(false);
  });
});

describe("liveFlowEdges", () => {
  test("drops arrows to frames that are gone, and self-loops", () => {
    const edges: FlowEdge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "gone" },
      { from: "gone", to: "b" },
      { from: "a", to: "a" },
    ];
    expect(liveFlowEdges({ frames: frames("a", "b"), edges })).toEqual([{ from: "a", to: "b" }]);
  });

  test("no edges is an empty list, not undefined", () => {
    expect(liveFlowEdges({ frames: frames("a") })).toEqual([]);
  });
});

describe("deriveFlowSteps", () => {
  test("a frame with no state arrows is a step alone", () => {
    const flow = deriveFlowSteps({ frames: frames("a", "b"), edges: [{ from: "a", to: "b" }] });
    expect(flow.steps).toEqual([
      { frame: "a", states: [] },
      { frame: "b", states: [] },
    ]);
    expect(flow.transitions).toEqual([{ from: "a", to: "b" }]);
  });

  test("state arrows fold their targets into the source's step", () => {
    const flow = deriveFlowSteps({
      frames: frames("form", "sending", "taken", "verify"),
      edges: [
        { from: "form", to: "sending", state: "loading", label: "Submit" },
        { from: "sending", to: "taken", state: "error", label: "Email already taken" },
        { from: "sending", to: "verify", label: "Account created" },
      ],
    });
    expect(flow.steps).toEqual([
      {
        frame: "form",
        states: [
          { frame: "sending", state: "loading", when: "Submit" },
          { frame: "taken", state: "error", when: "Email already taken", after: "sending" },
        ],
      },
      { frame: "verify", states: [] },
    ]);
    expect(flow.transitions).toEqual([{ from: "sending", to: "verify", label: "Account created" }]);
    expect(flow.stepOf.get("taken")).toBe("form");
    expect(flow.stepOf.get("verify")).toBe("verify");
  });

  test("states come out in the order they were drawn, depth first", () => {
    const flow = deriveFlowSteps({
      frames: frames("list", "empty", "loading", "failed"),
      edges: [
        { from: "list", to: "loading", state: "loading" },
        { from: "list", to: "empty", state: "empty" },
        { from: "loading", to: "failed", state: "error" },
      ],
    });
    expect(flow.steps[0]?.states.map((s) => s.state)).toEqual(["loading", "error", "empty"]);
  });

  test("a second state arrow into a frame reads as a transition", () => {
    const flow = deriveFlowSteps({
      frames: frames("a", "b", "c"),
      edges: [
        { from: "a", to: "c", state: "error" },
        { from: "b", to: "c", state: "empty" },
      ],
    });
    expect(flow.stepOf.get("c")).toBe("a");
    expect(flow.transitions).toEqual([{ from: "b", to: "c", state: "empty" }]);
  });

  test("a loop of state arrows still leaves every frame in a step", () => {
    const flow = deriveFlowSteps({
      frames: frames("a", "b"),
      edges: [
        { from: "a", to: "b", state: "loading" },
        { from: "b", to: "a", state: "error" },
      ],
    });
    expect(flow.steps).toEqual([{ frame: "a", states: [{ frame: "b", state: "loading" }] }]);
    expect(flow.transitions).toEqual([{ from: "b", to: "a", state: "error" }]);
  });
});

describe("flowEdgeProblem", () => {
  const board = (edges: FlowEdge[]) => ({ frames: frames("a", "b", "c"), edges });

  test("a well-formed flow has none", () => {
    expect(
      flowEdgeProblem(
        board([
          { from: "a", to: "b", state: "loading" },
          { from: "b", to: "c" },
          { from: "c", to: "b" },
        ]),
      ),
    ).toBeNull();
  });

  test("names the frame that isn't on the board", () => {
    expect(flowEdgeProblem(board([{ from: "a", to: "nope" }]))).toContain('"nope"');
  });

  test("refuses a self-loop and a repeated pair", () => {
    expect(flowEdgeProblem(board([{ from: "a", to: "a" }]))).toContain("itself");
    expect(
      flowEdgeProblem(
        board([
          { from: "a", to: "b" },
          { from: "a", to: "b", label: "again" },
        ]),
      ),
    ).toContain("two arrows");
  });

  test("a frame is one state of one step", () => {
    expect(
      flowEdgeProblem(
        board([
          { from: "a", to: "c", state: "error" },
          { from: "b", to: "c", state: "empty" },
        ]),
      ),
    ).toContain("already the error state");
  });

  test("state arrows can't loop", () => {
    expect(
      flowEdgeProblem(
        board([
          { from: "a", to: "b", state: "loading" },
          { from: "b", to: "a", state: "error" },
        ]),
      ),
    ).toContain("loops");
  });
});

describe("transitionsDrawnAsStates", () => {
  const board = (edges: FlowEdge[]) => ({
    frames: frames("form", "sending", "taken", "other"),
    edges,
  });
  const loading: FlowEdge = { from: "form", to: "sending", state: "loading" };
  const error: FlowEdge = { from: "sending", to: "taken", state: "error" };

  test("an arrow into a frame that is already that state of the same step restates it", () => {
    const again: FlowEdge = { from: "taken", to: "sending", state: "loading", label: "Try again" };
    expect(transitionsDrawnAsStates(board([loading, error, again]))).toEqual([again]);
  });

  test("it is found whichever order the arrows were drawn in", () => {
    const again: FlowEdge = { from: "taken", to: "sending", state: "loading" };
    // `taken` only joins the step through the arrow listed last.
    expect(transitionsDrawnAsStates(board([loading, again, error]))).toEqual([again]);
  });

  test("a different state for the same frame is a contradiction, not a restatement", () => {
    expect(
      transitionsDrawnAsStates(
        // `other` is a second state of the form, beside `sending`, not above it.
        board([
          loading,
          { from: "form", to: "other", state: "empty" },
          { from: "other", to: "sending", state: "error" },
        ]),
      ),
    ).toEqual([]);
  });

  test("the same state from another step is a contradiction too", () => {
    expect(
      transitionsDrawnAsStates(
        board([loading, { from: "other", to: "sending", state: "loading" }]),
      ),
    ).toEqual([]);
  });

  test("a way back to the step's default, whatever state it was given, is a transition", () => {
    const back: FlowEdge = { from: "taken", to: "form", state: "recovery", label: "Edit email" };
    expect(transitionsDrawnAsStates(board([loading, error, back]))).toEqual([back]);
    // Back to the state it came from, too.
    const retry: FlowEdge = { from: "taken", to: "sending", state: "retry" };
    expect(transitionsDrawnAsStates(board([loading, error, retry]))).toEqual([retry]);
  });

  test("`default` is where a step's states start, never one of them", () => {
    const home: FlowEdge = { from: "other", to: "form", state: "default" };
    expect(transitionsDrawnAsStates(board([loading, home]))).toEqual([home]);
  });

  test("they come back in the order they were drawn", () => {
    const back: FlowEdge = { from: "taken", to: "form", state: "recovery" };
    const again: FlowEdge = { from: "taken", to: "sending", state: "loading" };
    expect(transitionsDrawnAsStates(board([loading, again, error, back]))).toEqual([again, back]);
  });

  test("a flow with one state arrow per frame restates nothing", () => {
    expect(transitionsDrawnAsStates(board([loading, error]))).toEqual([]);
  });
});
