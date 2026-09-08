import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { selectedNode, useCanvas } from "../store.ts";
import { type FakeServer, screenFixture, serveFolder, snippetFixture } from "./fake-server.ts";

/**
 * Selection is the canvas's shared cursor — frames, Tree, HUD and Inspector all
 * read it, and all of them re-render when it changes. So the two things worth
 * pinning are the ones that aren't visible in any single component: the
 * dedupe-by-value that keeps a repeated click from re-rendering the world, and
 * the cross-slice follow-ons (screen switching, snippet focus) that a naive
 * `set({ selection })` would skip.
 */

let server: FakeServer;

const tree = {
  $ref: "Box",
  children: [
    { $ref: "Heading", props: { children: "title" } },
    { $ref: "Stack", children: [{ $ref: "Text", props: { children: "nested" } }] },
  ],
} as unknown as Screen["tree"];

beforeEach(() => {
  server = serveFolder({ boards: { main: ["home", "pricing"] } });
  useCanvas.setState({
    screens: { home: { ...screenFixture("home"), tree } as Screen },
    boards: {},
    currentScreenId: "home",
    currentBoardId: null,
    selection: null,
    hover: null,
    reveal: null,
    selectionIntent: "inspect",
    selectionComputed: null,
    snippetFocus: null,
  });
});

afterEach(() => {
  server.restore();
});

describe("selectedNode", () => {
  const screens = () => useCanvas.getState().screens;

  test("the empty path addresses the tree root", () => {
    expect(selectedNode(screens(), { screenId: "home", path: "" })).toEqual(
      screens().home?.tree as never,
    );
  });

  test("walks a dotted path into nested children", () => {
    const node = selectedNode(screens(), { screenId: "home", path: "1.0" });
    expect(node).toMatchObject({ $ref: "Text" });
  });

  test("returns null rather than throwing on anything that doesn't resolve", () => {
    expect(selectedNode(screens(), null)).toBeNull();
    expect(selectedNode(screens(), { screenId: "gone", path: "" })).toBeNull();
    expect(selectedNode(screens(), { screenId: "home", path: "9" })).toBeNull();
    expect(selectedNode(screens(), { screenId: "home", path: "-1" })).toBeNull();
    // Past a leaf: the Heading has no children to walk into.
    expect(selectedNode(screens(), { screenId: "home", path: "0.0" })).toBeNull();
  });
});

describe("setSelection", () => {
  test("re-selecting the same node by value doesn't churn the store", () => {
    const { setSelection } = useCanvas.getState();
    setSelection({ screenId: "home", path: "0" });
    const first = useCanvas.getState().selection;
    setSelection({ screenId: "home", path: "0" });
    expect(useCanvas.getState().selection).toBe(first);
  });

  test("a new node clears the previous node's computed style", () => {
    const { setSelection, setSelectionComputed } = useCanvas.getState();
    setSelection({ screenId: "home", path: "0" });
    setSelectionComputed("0", { fontSize: "24px" });
    expect(useCanvas.getState().selectionComputed).toEqual({ fontSize: "24px" });
    setSelection({ screenId: "home", path: "1" });
    expect(useCanvas.getState().selectionComputed).toBeNull();
  });

  test("a computed report for a node that is no longer selected is dropped", () => {
    const { setSelection, setSelectionComputed } = useCanvas.getState();
    setSelection({ screenId: "home", path: "1" });
    setSelectionComputed("0", { fontSize: "24px" });
    expect(useCanvas.getState().selectionComputed).toBeNull();
  });

  test("clears a pending reveal so the frame doesn't re-scroll", () => {
    const { revealSelection, setSelection } = useCanvas.getState();
    revealSelection({ screenId: "home", path: "0" });
    expect(useCanvas.getState().reveal).not.toBeNull();
    setSelection({ screenId: "home", path: "1" });
    expect(useCanvas.getState().reveal).toBeNull();
  });

  test("selecting on another screen follows the tree to it", async () => {
    useCanvas.getState().setSelection({ screenId: "pricing", path: "0" });
    await Bun.sleep(5);
    expect(useCanvas.getState().currentScreenId).toBe("pricing");
  });

  test("a snippet's synthetic screen never triggers a screen switch", async () => {
    useCanvas.setState({
      screens: {
        ...useCanvas.getState().screens,
        "snippet:card": screenFixture("snippet:card"),
      },
    });
    useCanvas.getState().setSelection({ screenId: "snippet:card", path: "" });
    await Bun.sleep(5);
    expect(useCanvas.getState().currentScreenId).toBe("home");
  });

  test("re-selecting restores the inspect intent a locate had suppressed", () => {
    const { revealSelection, setSelection } = useCanvas.getState();
    revealSelection({ screenId: "home", path: "0" }, { preserveTab: true });
    expect(useCanvas.getState().selectionIntent).toBe("preserve-tab");
    setSelection({ screenId: "home", path: "0" });
    expect(useCanvas.getState().selectionIntent).toBe("inspect");
  });
});

describe("revealSelection", () => {
  test("bumps a nonce so a repeat jump to the same node still scrolls", () => {
    const { revealSelection } = useCanvas.getState();
    revealSelection({ screenId: "home", path: "1.0" });
    const first = useCanvas.getState().reveal;
    revealSelection({ screenId: "home", path: "1.0" });
    const second = useCanvas.getState().reveal;
    // Both halves matter: frames key their scroll effect on the object, and
    // the nonce is what makes a repeat jump legible to anything that memoizes.
    expect(second).not.toBe(first);
    expect(second?.nonce).toBe((first?.nonce ?? 0) + 1);
  });

  test("preserveTab locates without stealing the right panel", () => {
    useCanvas.getState().revealSelection({ screenId: "home", path: "0" }, { preserveTab: true });
    expect(useCanvas.getState().selectionIntent).toBe("preserve-tab");
    expect(useCanvas.getState().selection).toEqual({ screenId: "home", path: "0" });
  });
});

describe("setHover", () => {
  test("an identical hover report doesn't re-render every subscriber", () => {
    const { setHover } = useCanvas.getState();
    setHover({ screenId: "home", path: "0" });
    const first = useCanvas.getState().hover;
    setHover({ screenId: "home", path: "0" });
    expect(useCanvas.getState().hover).toBe(first);
  });

  test("a different node, and clearing, both land", () => {
    const { setHover } = useCanvas.getState();
    setHover({ screenId: "home", path: "0" });
    setHover({ screenId: "home", path: "1" });
    expect(useCanvas.getState().hover).toEqual({ screenId: "home", path: "1" });
    setHover(null);
    expect(useCanvas.getState().hover).toBeNull();
  });
});

describe("setSnippetFocus", () => {
  test("entering focus virtualizes the definition and selects its root", async () => {
    server.snippets.card = snippetFixture("card");
    useCanvas.getState().setSnippetFocus("card");
    await Bun.sleep(10);
    expect(useCanvas.getState().screens["snippet:card"]).toBeDefined();
    expect(useCanvas.getState().selection).toEqual({ screenId: "snippet:card", path: "" });
  });

  test("entering drops a selection that addressed the enclosing screen", () => {
    server.snippets.card = snippetFixture("card");
    useCanvas.getState().setSelection({ screenId: "home", path: "1" });
    useCanvas.getState().setSnippetFocus("card");
    expect(useCanvas.getState().selection).toBeNull();
    expect(useCanvas.getState().hover).toBeNull();
  });

  test("leaving drops a selection that pointed into the definition", async () => {
    server.snippets.card = snippetFixture("card");
    useCanvas.getState().setSnippetFocus("card");
    await Bun.sleep(10);
    useCanvas.getState().setSnippetFocus(null);
    expect(useCanvas.getState().snippetFocus).toBeNull();
    expect(useCanvas.getState().selection).toBeNull();
  });

  test("re-entering the focus already held is a no-op", async () => {
    server.snippets.card = snippetFixture("card");
    useCanvas.getState().setSnippetFocus("card");
    await Bun.sleep(10);
    const before = server.calls.length;
    useCanvas.getState().setSnippetFocus("card");
    await Bun.sleep(10);
    expect(server.calls.slice(before)).toEqual([]);
  });

  test("a snippet that can't be fetched backs out of the mode", async () => {
    useCanvas.getState().setSnippetFocus("missing");
    await Bun.sleep(10);
    expect(useCanvas.getState().snippetFocus).toBeNull();
  });
});
