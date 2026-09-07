import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readLastBoard, writeLastBoard } from "../board-memory.ts";
import { useCanvas } from "../store.ts";

/**
 * Which board a reload lands on. The canvas used to open the folder's default
 * board — or, with none configured, whichever board sorted first — so anyone
 * working on their second board started every session by navigating back to
 * it. `loadDesign` now consults this browser's memory of where it left off,
 * while still yielding to the two places a board is asked for explicitly: a
 * shared URL, and a `defaultBoard` someone deliberately pinned.
 */

const realFetch = globalThis.fetch;
const realStorage = (globalThis as { localStorage?: unknown }).localStorage;

let defaultBoard: string | null;

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
}

function summary() {
  return {
    snapshotVersion: "test",
    theme: { name: "default" },
    defaultScreen: null,
    defaultBoard,
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    screens: [],
    boards: ["alpha", "beta", "gamma"].map((id) => ({ id, name: id, frameCount: 0 })),
    archivedBoards: [],
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
  defaultBoard = null;
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/design")) return json(summary());
    if (url.includes("/api/board/")) {
      const id = url.split("/api/board/")[1] as string;
      return json({ id, name: id, frames: [], groups: [] });
    }
    if (url.includes("/api/theme")) return json({ name: "default" });
    if (url.includes("/api/presets")) return json({ presets: [] });
    if (url.includes("/api/history")) return json({ undo: 0, redo: 0 });
    // Notes / comments / annotations refreshes ride along on selectBoard.
    return json([]);
  }) as typeof fetch;

  useCanvas.setState({
    design: null,
    boards: {},
    screens: {},
    theme: null,
    currentBoardId: null,
    currentScreenId: null,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { localStorage?: unknown }).localStorage = realStorage;
});

describe("which board the canvas reopens", () => {
  test("with nothing remembered, the first board", async () => {
    await useCanvas.getState().loadDesign();
    expect(useCanvas.getState().currentBoardId).toBe("alpha");
  });

  test("the board this browser was last on", async () => {
    writeLastBoard("gamma");
    await useCanvas.getState().loadDesign();
    expect(useCanvas.getState().currentBoardId).toBe("gamma");
  });

  test("switching boards is what updates the memory", async () => {
    await useCanvas.getState().loadDesign();
    await useCanvas.getState().selectBoard("beta");
    expect(readLastBoard()).toBe("beta");
  });

  test("a URL seed wins — a shared link must open what it points at", async () => {
    writeLastBoard("gamma");
    await useCanvas.getState().loadDesign({ boardId: "beta" });
    expect(useCanvas.getState().currentBoardId).toBe("beta");
  });

  test("a pinned defaultBoard wins too — it's a deliberate 'always open here'", async () => {
    defaultBoard = "beta";
    writeLastBoard("gamma");
    await useCanvas.getState().loadDesign();
    expect(useCanvas.getState().currentBoardId).toBe("beta");
  });

  test("a remembered board that's gone falls through instead of blanking the canvas", async () => {
    writeLastBoard("deleted-last-week");
    await useCanvas.getState().loadDesign();
    expect(useCanvas.getState().currentBoardId).toBe("alpha");
  });
});
