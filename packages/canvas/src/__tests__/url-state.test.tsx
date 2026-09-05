import { afterEach, beforeEach, expect, test } from "bun:test";
import { domSuite, interact, mount } from "./dom.ts";

/**
 * The canvas's URL is its deep-link and its back button. Two halves, both
 * previously untested: parsing what someone pasted in (a trust boundary — the
 * params are user input), and the push-vs-replace discipline on the way out,
 * where "push on every state shuffle" spams history into uselessness and
 * "replace on a navigation" breaks the back button outright.
 */

const { readUrlState, useUrlState } = await import("../url-state.ts");
const { useCanvas } = await import("../store.ts");

function at(search: string): void {
  window.history.replaceState({}, "", `/${search}`);
}

/** A component that does nothing but keep the URL in sync with the store. */
function UrlSync() {
  useUrlState();
  return null;
}

const baseState = {
  view: "boards" as const,
  libraryItem: null,
  currentBoardId: null,
  currentScreenId: null,
  selection: null,
  editingSnippetId: null,
};

beforeEach(() => {
  at("");
  useCanvas.setState(baseState);
});

afterEach(() => {
  at("");
});

domSuite("readUrlState", () => {
  test("defaults to the board view when the URL says nothing", () => {
    at("");
    expect(readUrlState()).toEqual({
      view: "boards",
      libraryItem: null,
      boardId: null,
      screenId: null,
      selection: null,
      snippetId: null,
    });
  });

  test("reads a board deep link with a selected node", () => {
    at("?board=marketing&screen=pricing&sel=0.2.1");
    expect(readUrlState()).toMatchObject({
      view: "boards",
      boardId: "marketing",
      screenId: "pricing",
      selection: { screenId: "pricing", path: "0.2.1" },
    });
  });

  test("treats the root path as a selection, not as absent", () => {
    at("?screen=home&sel=");
    expect(readUrlState().selection).toEqual({ screenId: "home", path: "" });
  });

  test("has no selection without a screen to anchor it to", () => {
    at("?sel=0.1");
    expect(readUrlState().selection).toBeNull();
  });

  test("reads a library item, keeping colons in the id", () => {
    at("?view=library&item=component:shadcn:button");
    expect(readUrlState()).toMatchObject({
      view: "library",
      libraryItem: { kind: "component", id: "shadcn:button" },
    });
  });

  test("ignores an item of an unknown kind or with no id", () => {
    at("?view=library&item=widget:button");
    expect(readUrlState().libraryItem).toBeNull();
    at("?view=library&item=component");
    expect(readUrlState().libraryItem).toBeNull();
  });

  test("only honors item in the library view, and snippet in the snippet view", () => {
    at("?item=component:button&snippet=card");
    const boards = readUrlState();
    expect(boards.libraryItem).toBeNull();
    expect(boards.snippetId).toBeNull();

    at("?view=snippet&snippet=card");
    expect(readUrlState()).toMatchObject({ view: "snippet", snippetId: "card" });
  });

  test("falls back to boards for a view it doesn't know", () => {
    at("?view=inspector");
    expect(readUrlState().view).toBe("boards");
  });
});

domSuite("useUrlState — writing", () => {
  test("mirrors the board view into the query string", async () => {
    const view = await mount(<UrlSync />);
    try {
      await interact(() =>
        useCanvas.setState({ currentBoardId: "marketing", currentScreenId: "pricing" }),
      );
      expect(window.location.search).toBe("?board=marketing&screen=pricing");
    } finally {
      await view.unmount();
    }
  });

  test("drops the board keys when the library takes over", async () => {
    useCanvas.setState({ currentBoardId: "marketing", currentScreenId: "pricing" });
    const view = await mount(<UrlSync />);
    try {
      await interact(() =>
        useCanvas.setState({ view: "library", libraryItem: { kind: "snippet", id: "stat-card" } }),
      );
      expect(window.location.search).toBe("?view=library&item=snippet%3Astat-card");
    } finally {
      await view.unmount();
    }
  });

  test("replaces rather than pushes while you shuffle around one board", async () => {
    useCanvas.setState({ currentBoardId: "marketing" });
    const view = await mount(<UrlSync />);
    try {
      const before = window.history.length;
      await interact(() => useCanvas.setState({ currentScreenId: "pricing" }));
      await interact(() => useCanvas.setState({ selection: { screenId: "pricing", path: "0.1" } }));
      expect(window.history.length).toBe(before);
      expect(window.location.search).toContain("sel=0.1");
    } finally {
      await view.unmount();
    }
  });

  test("pushes on the navigations the back button has to return from", async () => {
    useCanvas.setState({ currentBoardId: "marketing" });
    const view = await mount(<UrlSync />);
    try {
      // Switching boards is navigation.
      let before = window.history.length;
      await interact(() => useCanvas.setState({ currentBoardId: "app" }));
      expect(window.history.length).toBe(before + 1);

      // So is changing view...
      before = window.history.length;
      await interact(() => useCanvas.setState({ view: "library", libraryItem: null }));
      expect(window.history.length).toBe(before + 1);

      // ...and so is walking from library home into a component detail, which
      // is what makes back come out of the detail instead of leaving the app.
      before = window.history.length;
      await interact(() =>
        useCanvas.setState({ libraryItem: { kind: "component", id: "button" } }),
      );
      expect(window.history.length).toBe(before + 1);
    } finally {
      await view.unmount();
    }
  });

  test("the very first render replaces, so a deep link isn't stacked twice", async () => {
    at("?board=marketing");
    useCanvas.setState({ currentBoardId: "marketing" });
    const before = window.history.length;
    const view = await mount(<UrlSync />);
    try {
      expect(window.history.length).toBe(before);
    } finally {
      await view.unmount();
    }
  });
});
