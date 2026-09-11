import { beforeEach, describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { useCanvas } from "../store.ts";

/**
 * Store-level tests for the snippet editor's synthetic-screen seam.
 * The bug we're guarding against: `setSyntheticScreen` used to bump
 * `screenVersion` on every call, which combined with a `useEffect`
 * dependency in `SnippetView` created an infinite re-fetch loop —
 * the user saw "Loading snippet…" forever because each successful
 * fetch immediately re-triggered itself. The store is now idempotent
 * against deep-equal payloads, which short-circuits the loop even if
 * the dep array slips back.
 */

function reset(): void {
  useCanvas.setState({
    screens: {},
    screenVersion: 0,
    editingSnippetId: null,
    preSnippetView: null,
    view: "boards",
    selection: null,
    hover: null,
  });
}

const SCREEN: Screen = {
  id: "snippet:feature-row",
  name: "Feature Row",
  tree: {
    $ref: "Card",
    props: { className: "p-4" },
    children: [{ $ref: "Heading", props: { level: 3, children: "Title" } }],
  },
};

beforeEach(reset);

describe("setSyntheticScreen", () => {
  test("installs the screen under the given id + bumps screenVersion", () => {
    const before = useCanvas.getState().screenVersion;
    useCanvas.getState().setSyntheticScreen("snippet:feature-row", SCREEN);

    const state = useCanvas.getState();
    expect(state.screens["snippet:feature-row"]).toEqual(SCREEN);
    expect(state.screenVersion).toBe(before + 1);
  });

  test("does NOT bump screenVersion when called with a structurally identical screen", () => {
    // This is the load-bearing assertion: the regression guard. A
    // useEffect that listens to `screenVersion` and calls
    // `setSyntheticScreen(sameScreen)` must not be able to ping-pong
    // forever — the second call has to be a no-op for state changes.
    useCanvas.getState().setSyntheticScreen("snippet:feature-row", SCREEN);
    const afterFirst = useCanvas.getState().screenVersion;

    // Same object reference.
    useCanvas.getState().setSyntheticScreen("snippet:feature-row", SCREEN);
    expect(useCanvas.getState().screenVersion).toBe(afterFirst);

    // Different object reference but structurally equal — still a no-op.
    const clone: Screen = JSON.parse(JSON.stringify(SCREEN));
    useCanvas.getState().setSyntheticScreen("snippet:feature-row", clone);
    expect(useCanvas.getState().screenVersion).toBe(afterFirst);
  });

  test("bumps screenVersion when the synthetic screen content changes", () => {
    useCanvas.getState().setSyntheticScreen("snippet:feature-row", SCREEN);
    const afterFirst = useCanvas.getState().screenVersion;

    const updated: Screen = {
      ...SCREEN,
      tree: {
        $ref: "Card",
        // className differs from the original — that's the change we
        // expect to bump the version.
        props: { className: "p-8 rounded-xl" },
        children: [{ $ref: "Heading", props: { level: 3, children: "Title" } }],
      },
    };
    useCanvas.getState().setSyntheticScreen("snippet:feature-row", updated);
    expect(useCanvas.getState().screenVersion).toBe(afterFirst + 1);
    expect(useCanvas.getState().screens["snippet:feature-row"]).toEqual(updated);
  });

  test("closeSnippetEditor sweeps every snippet:* synthetic screen", () => {
    // Pre-populate state as if the user had two synthetic screens
    // installed plus a real one.
    useCanvas.setState({
      screens: {
        "real-screen": { id: "real-screen", name: "Real", tree: { $ref: "Card" } } as Screen,
        "snippet:a": { ...SCREEN, id: "snippet:a" },
        "snippet:b": { ...SCREEN, id: "snippet:b" },
      },
      view: "snippet",
      editingSnippetId: "a",
      preSnippetView: "boards",
    });

    useCanvas.getState().closeSnippetEditor();

    const state = useCanvas.getState();
    expect(state.view).toBe("boards");
    expect(state.editingSnippetId).toBeNull();
    expect(state.screens["real-screen"]).toBeDefined();
    expect(state.screens["snippet:a"]).toBeUndefined();
    expect(state.screens["snippet:b"]).toBeUndefined();
  });
});

describe("setSelection", () => {
  test("doesn't auto-follow into a snippet:* virtual screen", () => {
    // Auto-follow exists so a click on the canvas brings the right
    // screen into the boards Tree. But snippet-virtual screens are
    // editor-only and don't live on disk — auto-following them would
    // hit /api/screen/snippet:foo (404) and confuse the boards mode.
    useCanvas.setState({ currentScreenId: "landing", currentBoardId: "marketing" });

    // The store is a module singleton: a serial `bun test` hands it to the next
    // file, which must get the real action back.
    const { selectScreen } = useCanvas.getState();
    let selectScreenCalls = 0;
    useCanvas.setState({
      selectScreen: async (_id: string) => {
        selectScreenCalls += 1;
      },
    });

    try {
      useCanvas.getState().setSelection({ screenId: "snippet:feature-row", path: "" });
    } finally {
      useCanvas.setState({ selectScreen });
    }
    expect(selectScreenCalls).toBe(0);
    expect(useCanvas.getState().selection).toEqual({
      screenId: "snippet:feature-row",
      path: "",
    });
  });
});
