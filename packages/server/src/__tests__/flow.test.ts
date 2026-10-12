import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Board, FlowEdge } from "@velloo/schema";
import { flowSpec } from "../flow.ts";
import { designBoard, designScreen, testContext } from "../testing/design-folder.ts";

let folder: Awaited<ReturnType<typeof testContext>>;

const SCREENS = ["form", "sending", "taken", "verify", "welcome", "pricing"];
const frame = (screen: string) => `frame-${screen}`;

beforeEach(async () => {
  folder = await testContext({
    label: "flow-spec",
    screens: {
      ...Object.fromEntries(SCREENS.map((id) => [id, true as const])),
      form: designScreen("form", { name: "Sign up", route: "/signup" }),
    },
  });
});

afterEach(() => folder.cleanup());

const spec = (edges: FlowEdge[], overrides: Partial<Board> = {}) =>
  flowSpec(folder.folder, designBoard("signup", SCREENS, { name: "Sign up", edges, ...overrides }));

describe("flowSpec", () => {
  test("reads steps, their states, and the transitions between them", () => {
    const flow = spec([
      { from: frame("form"), to: frame("sending"), state: "loading", label: "Submit" },
      { from: frame("sending"), to: frame("taken"), state: "error", label: "Email already taken" },
      { from: frame("taken"), to: frame("form"), label: "Try again" },
      { from: frame("sending"), to: frame("verify"), label: "Account created" },
      { from: frame("verify"), to: frame("welcome") },
    ]);
    expect(flow).toEqual({
      boardId: "signup",
      name: "Sign up",
      steps: [
        {
          frame: frame("form"),
          screen: "form",
          name: "Sign up",
          route: "/signup",
          states: [
            { state: "loading", frame: frame("sending"), screen: "sending", when: "Submit" },
            { state: "error", frame: frame("taken"), screen: "taken", when: "Email already taken" },
          ],
        },
        { frame: frame("verify"), screen: "verify", name: "Verify" },
        { frame: frame("welcome"), screen: "welcome", name: "Welcome" },
      ],
      transitions: [
        { from: frame("taken"), to: frame("form"), when: "Try again" },
        { from: frame("sending"), to: frame("verify"), when: "Account created" },
        { from: frame("verify"), to: frame("welcome") },
      ],
      starts: [frame("form")],
      ends: [frame("welcome")],
      unconnected: [frame("pricing")],
    });
  });

  test("an arrow back into its own step doesn't make the step an exit or an entry", () => {
    const flow = spec([
      { from: frame("form"), to: frame("taken"), state: "error" },
      { from: frame("taken"), to: frame("form"), label: "Try again" },
    ]);
    expect(flow.starts).toEqual([frame("form")]);
    expect(flow.ends).toEqual([frame("form")]);
  });

  test("a step that loads but can't fail is a gap", () => {
    const loading = { from: frame("form"), to: frame("sending"), state: "loading" };
    expect(spec([loading]).gaps).toEqual([
      { step: frame("form"), missing: "error", why: "it has a loading state" },
    ]);
    expect(
      spec([loading, { from: frame("sending"), to: frame("taken"), state: "error" }]).gaps,
    ).toBeUndefined();
  });

  test("a step with no loading state owes no other state", () => {
    expect(spec([{ from: frame("form"), to: frame("verify") }]).gaps).toBeUndefined();
  });

  test("the same screen framed twice isn't a screen the flow forgot", () => {
    const board = designBoard("signup", ["form", "verify"]);
    const twin = { ...board.frames[0], id: "form-mobile", w: 390 } as Board["frames"][number];
    const flow = flowSpec(folder.folder, {
      ...board,
      frames: [...board.frames, twin],
      edges: [{ from: frame("form"), to: frame("verify") }],
    });
    expect(flow.unconnected).toBeUndefined();
  });

  test("a frame label names the step ahead of the screen", () => {
    const board = designBoard("signup", ["form", "verify"]);
    const flow = flowSpec(folder.folder, {
      ...board,
      frames: board.frames.map((f) => (f.id === frame("form") ? { ...f, label: "Step 1" } : f)),
      edges: [{ from: frame("form"), to: frame("verify") }],
    });
    expect(flow.steps[0]?.name).toBe("Step 1");
  });

  test("a board with no arrows is all unconnected frames", () => {
    const flow = spec([]);
    expect(flow.steps).toEqual([]);
    expect(flow.unconnected).toEqual(SCREENS.map(frame));
  });
});
