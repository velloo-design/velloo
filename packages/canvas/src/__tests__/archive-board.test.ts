import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useCanvas } from "../store.ts";

/**
 * `setBoardArchived` is the seam where archiving stops being a server concern:
 * a board that leaves the summary's live list can't stay selected, or the
 * canvas keeps rendering a board the user just filed away. These drive the
 * store against a stubbed daemon.
 */

const realFetch = globalThis.fetch;

/** Boards the fake daemon currently considers archived. */
let archived: Set<string>;
/** Every mutation the store sent, in order. */
let calls: { tool: string; args: unknown }[];

function boardSummary(id: string) {
  return { id, name: id, frameCount: 0 };
}

function summary() {
  const ids = ["alpha", "beta"];
  return {
    snapshotVersion: "test",
    theme: { name: "default" },
    defaultScreen: null,
    defaultBoard: null,
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    screens: [],
    boards: ids.filter((id) => !archived.has(id)).map(boardSummary),
    archivedBoards: ids
      .filter((id) => archived.has(id))
      .map((id) => ({ ...boardSummary(id), archivedAt: "2026-08-25T10:00:00.000Z" })),
    snippets: [],
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  archived = new Set();
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/mutate/")) {
      const tool = url.split("/api/mutate/")[1] as string;
      const args = JSON.parse(String(init?.body ?? "{}")) as {
        boardId: string;
        patch?: { archived?: boolean };
      };
      calls.push({ tool, args });
      if (tool === "update_board" && args.patch?.archived !== undefined) {
        if (args.patch.archived) archived.add(args.boardId);
        else archived.delete(args.boardId);
      }
      return json({});
    }
    if (url.includes("/api/design")) return json(summary());
    if (url.includes("/api/board/")) {
      const id = url.split("/api/board/")[1] as string;
      return json({ id, name: id, frames: [], groups: [] });
    }
    // Notes/annotations refreshes ride along on selectBoard.
    return json([]);
  }) as typeof fetch;

  useCanvas.setState({
    design: summary() as never,
    boards: {},
    screens: {},
    currentBoardId: "alpha",
    currentScreenId: null,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("setBoardArchived", () => {
  test("archiving sends the patch and refreshes the summary's two lists", async () => {
    await useCanvas.getState().setBoardArchived("beta", true);
    expect(calls).toEqual([
      { tool: "update_board", args: { boardId: "beta", patch: { archived: true } } },
    ]);
    const design = useCanvas.getState().design;
    expect(design?.boards.map((b) => b.id)).toEqual(["alpha"]);
    expect(design?.archivedBoards?.map((b) => b.id)).toEqual(["beta"]);
  });

  test("archiving a board you aren't looking at leaves the selection alone", async () => {
    await useCanvas.getState().setBoardArchived("beta", true);
    expect(useCanvas.getState().currentBoardId).toBe("alpha");
  });

  test("archiving the open board moves the selection to the first live board", async () => {
    await useCanvas.getState().setBoardArchived("alpha", true);
    expect(useCanvas.getState().currentBoardId).toBe("beta");
  });

  test("archiving the last live board clears the canvas rather than reopening it", async () => {
    await useCanvas.getState().setBoardArchived("beta", true);
    await useCanvas.getState().setBoardArchived("alpha", true);
    const state = useCanvas.getState();
    expect(state.currentBoardId).toBeNull();
    expect(state.currentScreenId).toBeNull();
  });

  test("restoring puts the board back in the live list", async () => {
    await useCanvas.getState().setBoardArchived("beta", true);
    await useCanvas.getState().setBoardArchived("beta", false);
    const design = useCanvas.getState().design;
    expect(design?.boards.map((b) => b.id)).toEqual(["alpha", "beta"]);
    expect(design?.archivedBoards).toEqual([]);
    // Restoring never steals the selection.
    expect(useCanvas.getState().currentBoardId).toBe("alpha");
  });
});
