import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import type { SearchResponse } from "../api.ts";
import { $, $$, domSuite, interact, mount, press, settle, text, typeInto } from "./dom.ts";

/**
 * Ctrl+K search, driven the way a person drives it. None of this is reachable
 * from a server-rendered string: the debounce, the ↑↓ cursor walking across
 * group boundaries, Tab cycling the filter, and Enter committing a result into
 * real store navigation are all behavior, not markup.
 *
 * The debounce is 120ms in the component; the waits below clear it.
 */

const searchCalls: string[] = [];
let respond: (q: string) => SearchResponse | Promise<SearchResponse>;

// Stub the network, not the api module: the component still goes through the
// real fetchSearch/getJson path, so a change to the query string or the
// response contract shows up here.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname !== "/api/search") throw new Error(`unexpected fetch: ${url.pathname}`);
  const q = url.searchParams.get("q") ?? "";
  searchCalls.push(q);
  return Response.json(await respond(q));
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

// Dynamic, and after ./dom.ts: React has to bind happy-dom's globals, and a
// static import here would be sorted above the registration.
const { SearchDialog } = await import("../components/SearchDialog.tsx");
const { useCanvas } = await import("../store.ts");

const emptyResults = (query: string): SearchResponse => ({
  query,
  boards: [],
  screens: [],
  text: [],
  textTotal: 0,
});

const fullResults = (query: string): SearchResponse => ({
  query,
  boards: [{ id: "marketing", name: "Marketing", frameCount: 3, archived: false }],
  screens: [
    {
      id: "pricing",
      name: "Pricing",
      boards: [{ id: "marketing", name: "Marketing", archived: false }],
    },
    { id: "landing", name: "Landing", boards: [] },
  ],
  text: [
    {
      screenId: "landing",
      screenName: "Landing",
      board: { id: "marketing", name: "Marketing" },
      path: [0, 2],
      kind: "component",
      ref: "Heading",
      prop: "children",
      excerpt: "Pricing that scales with you",
      matchStart: 0,
      matchEnd: 7,
    },
  ],
  textTotal: 1,
});

/** Every row the dialog is currently offering, in cursor order. */
const rows = (): HTMLElement[] => $$("[data-result-index]");
const activeRow = (): HTMLElement | undefined =>
  rows().find((row) => row.className.includes("bg-accent"));

async function openWithResults(
  results: (q: string) => SearchResponse | Promise<SearchResponse> = fullResults,
) {
  respond = results;
  const view = await mount(<SearchDialog />);
  await interact(() => useCanvas.getState().setSearchOpen(true));
  const input = $("input") as HTMLInputElement;
  await interact(() => typeInto(input, "pricing"));
  await settle(200);
  return { view, input };
}

beforeEach(() => {
  searchCalls.length = 0;
  respond = fullResults;
  useCanvas.setState({ searchOpen: false, view: "boards", currentBoardId: null, boards: {} });
});

afterEach(() => {
  useCanvas.setState({ searchOpen: false });
});

domSuite("opening and querying", () => {
  test("stays closed until the store says otherwise", async () => {
    const view = await mount(<SearchDialog />);
    try {
      expect($("input")).toBeNull();
      await interact(() => useCanvas.getState().setSearchOpen(true));
      expect($("input")).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });

  test("prompts before a query and debounces the keystrokes into one fetch", async () => {
    respond = fullResults;
    const view = await mount(<SearchDialog />);
    try {
      await interact(() => useCanvas.getState().setSearchOpen(true));
      expect(text($("[role=dialog]"))).toContain("Type to search");

      const input = $("input") as HTMLInputElement;
      await interact(() => typeInto(input, "p"));
      await interact(() => typeInto(input, "pr"));
      await interact(() => typeInto(input, "pricing"));
      await settle(200);

      // Three keystrokes inside the debounce window, one request.
      expect(searchCalls).toEqual(["pricing"]);
      expect(rows()).toHaveLength(4);
    } finally {
      await view.unmount();
    }
  });

  test("says so when nothing matched, quoting the query the server echoed", async () => {
    const { view } = await openWithResults(emptyResults);
    try {
      expect(text($("[role=dialog]"))).toContain("No matches for");
      expect(rows()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  test("clearing the query drops back to the prompt without another fetch", async () => {
    const { view, input } = await openWithResults();
    try {
      expect(searchCalls).toEqual(["pricing"]);
      await interact(() => typeInto(input, ""));
      await settle(200);
      expect(searchCalls).toEqual(["pricing"]);
      expect(text($("[role=dialog]"))).toContain("Type to search");
    } finally {
      await view.unmount();
    }
  });

  test("re-opening starts empty rather than on the last query", async () => {
    const { view, input } = await openWithResults();
    try {
      expect(input.value).toBe("pricing");
      await interact(() => useCanvas.getState().setSearchOpen(false));
      await interact(() => useCanvas.getState().setSearchOpen(true));
      expect(($("input") as HTMLInputElement).value).toBe("");
      expect(text($("[role=dialog]"))).toContain("Type to search");
    } finally {
      await view.unmount();
    }
  });

  test("ignores a slow response that a newer query already answered past", async () => {
    const view = await mount(<SearchDialog />);
    try {
      await interact(() => useCanvas.getState().setSearchOpen(true));
      const input = $("input") as HTMLInputElement;

      let releaseStale: (() => void) | null = null;
      respond = (q) =>
        q === "stale"
          ? new Promise<SearchResponse>((resolve) => {
              releaseStale = () => resolve({ ...fullResults(q), boards: [] });
            })
          : fullResults(q);

      await interact(() => typeInto(input, "stale"));
      await settle(200);
      await interact(() => typeInto(input, "pricing"));
      await settle(200);
      // The stale request answers last; its results must not replace the ones
      // the user is looking at.
      await interact(async () => releaseStale?.());
      await settle(20);

      expect(rows()).toHaveLength(4);
    } finally {
      await view.unmount();
    }
  });
});

domSuite("keyboard navigation", () => {
  test("the cursor starts on the first row and walks across group boundaries", async () => {
    const { view } = await openWithResults();
    try {
      const dialog = $("[role=dialog]") as HTMLElement;
      expect(activeRow()?.dataset.resultIndex).toBe("0");

      // 1 board + 2 screens + 1 text hit: ↓ crosses both group labels.
      for (const expected of ["1", "2", "3"]) {
        await interact(() => press(dialog, "ArrowDown"));
        expect(activeRow()?.dataset.resultIndex).toBe(expected);
      }
      // ...and stops at the end rather than wrapping.
      await interact(() => press(dialog, "ArrowDown"));
      expect(activeRow()?.dataset.resultIndex).toBe("3");

      await interact(() => press(dialog, "ArrowUp"));
      expect(activeRow()?.dataset.resultIndex).toBe("2");
    } finally {
      await view.unmount();
    }
  });

  test("ArrowUp on the first row stays put instead of going negative", async () => {
    const { view } = await openWithResults();
    try {
      const dialog = $("[role=dialog]") as HTMLElement;
      await interact(() => press(dialog, "ArrowUp"));
      expect(activeRow()?.dataset.resultIndex).toBe("0");
    } finally {
      await view.unmount();
    }
  });

  test("Tab cycles the filter forward and Shift+Tab back, resetting the cursor", async () => {
    const { view } = await openWithResults();
    try {
      const dialog = $("[role=dialog]") as HTMLElement;
      await interact(() => press(dialog, "ArrowDown"));
      expect(activeRow()?.dataset.resultIndex).toBe("1");

      await interact(() => press(dialog, "Tab")); // all -> boards
      expect(rows()).toHaveLength(1);
      expect(activeRow()?.dataset.resultIndex).toBe("0");

      await interact(() => press(dialog, "Tab")); // boards -> screens
      expect(rows()).toHaveLength(2);

      await interact(() => press(dialog, "Tab", { shiftKey: true })); // back to boards
      expect(rows()).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });

  test("the filter chips carry the per-group counts", async () => {
    const { view } = await openWithResults();
    try {
      const chips = $$("[role=dialog] button")
        .filter((b) => !b.hasAttribute("data-result-index"))
        .map((b) => text(b));
      expect(chips).toContain("All 4");
      expect(chips).toContain("boards 1");
      expect(chips).toContain("screens 2");
      expect(chips).toContain("text 1");
    } finally {
      await view.unmount();
    }
  });
});

domSuite("committing a result", () => {
  test("Enter on a board result closes the dialog and selects that board", async () => {
    const selected: string[] = [];
    useCanvas.setState({ selectBoard: async (id: string) => void selected.push(id) });
    const { view } = await openWithResults();
    try {
      await interact(() => press($("[role=dialog]") as HTMLElement, "Enter"));
      expect(selected).toEqual(["marketing"]);
      expect(useCanvas.getState().searchOpen).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  test("clicking a screen row selects the screen, following its hosting board", async () => {
    const selectedBoards: string[] = [];
    const selectedScreens: string[] = [];
    useCanvas.setState({
      selectBoard: async (id: string) => void selectedBoards.push(id),
      selectScreen: async (id: string) => void selectedScreens.push(id),
    });
    const { view } = await openWithResults();
    try {
      const screenRow = rows()[1];
      await interact(() => screenRow?.click());
      expect(selectedBoards).toEqual(["marketing"]);
      expect(selectedScreens).toEqual(["pricing"]);
    } finally {
      await view.unmount();
    }
  });

  test("a text match reveals the matched node, not just its screen", async () => {
    const revealed: { screenId: string; path: string }[] = [];
    useCanvas.setState({
      selectBoard: async () => undefined,
      selectScreen: async () => undefined,
      revealSelection: (arg: { screenId: string; path: string }) => void revealed.push(arg),
    });
    const { view } = await openWithResults();
    try {
      const textRow = rows()[3];
      await interact(() => textRow?.click());
      expect(revealed).toEqual([{ screenId: "landing", path: "0.2" }]);
    } finally {
      await view.unmount();
    }
  });

  test("navigating from the library view switches back to the board view first", async () => {
    useCanvas.setState({ view: "library", selectBoard: async () => undefined });
    const { view } = await openWithResults();
    try {
      await interact(() => press($("[role=dialog]") as HTMLElement, "Enter"));
      expect(useCanvas.getState().view).toBe("boards");
    } finally {
      await view.unmount();
    }
  });

  test("Enter with nothing to commit is a no-op, not a crash", async () => {
    const { view } = await openWithResults(emptyResults);
    try {
      await interact(() => press($("[role=dialog]") as HTMLElement, "Enter"));
      expect(useCanvas.getState().searchOpen).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});

domSuite("highlighting", () => {
  test("marks the matched run inside a result, case-insensitively", async () => {
    const { view } = await openWithResults((q) => ({
      ...emptyResults(q),
      boards: [{ id: "b", name: "PRICING plans", frameCount: 1, archived: false }],
    }));
    try {
      expect(text($("[role=dialog] mark"))).toBe("PRICING");
    } finally {
      await view.unmount();
    }
  });
});
