import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Board } from "@velloo/schema";
import { useCanvas } from "../store.ts";
import {
  type FakeServer,
  frameId,
  screenFixture,
  serveFolder,
  stubLocalStorage,
} from "./fake-server.ts";

/**
 * The design slice is the canvas's whole relationship with the daemon: where a
 * session opens, which screen the tree is scoped to, and what survives a
 * reconnect. Almost none of it is reachable from a render assertion — the
 * decisions are made in `set`/`get` before anything paints — and the ones that
 * matter most are precedence chains and failure paths, which regress silently.
 */

let server: FakeServer;
let restoreStorage: (() => void) | null = null;

/** Back to the slice's declared initial state, without booting. */
function resetStore(): void {
  useCanvas.setState({
    design: null,
    folderConfig: null,
    screens: {},
    boards: {},
    currentBoardId: null,
    currentScreenId: null,
    screenVersion: 0,
    screenVersions: {},
    components: null,
    componentsLoading: false,
    generatedAssets: {},
    theme: null,
    themeName: "default",
    themeVersion: 0,
    wsConnected: false,
    wsEverConnected: false,
    bootError: null,
    annotations: [],
    notes: [],
    commentThreads: [],
    selection: null,
  });
}

beforeEach(() => {
  resetStore();
  server = serveFolder({ boards: { main: ["home", "pricing"], docs: ["guide"] } });
});

afterEach(() => {
  server.restore();
  restoreStorage?.();
  restoreStorage = null;
});

const boot = (seed?: { boardId?: string | null; screenId?: string | null }) =>
  useCanvas.getState().loadDesign(seed);

describe("loadDesign — where a session opens", () => {
  test("opens the first board when nothing else says otherwise", async () => {
    await boot();
    expect(useCanvas.getState().currentBoardId).toBe("main");
    expect(useCanvas.getState().currentScreenId).toBe("home");
    expect(useCanvas.getState().bootError).toBeNull();
  });

  test("a URL seed wins over the configured default", async () => {
    server.design.defaultBoard = "main";
    await boot({ boardId: "docs" });
    expect(useCanvas.getState().currentBoardId).toBe("docs");
  });

  test("the configured default beats this browser's memory", async () => {
    restoreStorage = stubLocalStorage({ "velloo:lastBoard": "docs" });
    server.design.defaultBoard = "main";
    await boot();
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });

  test("this browser's memory is used when no default is configured", async () => {
    restoreStorage = stubLocalStorage({ "velloo:lastBoard": "docs" });
    await boot();
    expect(useCanvas.getState().currentBoardId).toBe("docs");
  });

  test("skips a seed, default or memory naming a board that's gone", async () => {
    restoreStorage = stubLocalStorage({ "velloo:lastBoard": "deleted-too" });
    server.design.defaultBoard = "deleted";
    await boot({ boardId: "also-deleted" });
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });

  test("keeps the board already open across a re-load", async () => {
    await boot();
    await useCanvas.getState().selectBoard("docs");
    await boot();
    expect(useCanvas.getState().currentBoardId).toBe("docs");
  });

  test("a screen seed is honoured even when the board scoped another", async () => {
    await boot({ screenId: "pricing" });
    expect(useCanvas.getState().currentScreenId).toBe("pricing");
  });

  test("ignores a screen seed the folder doesn't have", async () => {
    await boot({ screenId: "ghost" });
    expect(useCanvas.getState().currentScreenId).toBe("home");
  });

  test("falls back to defaultScreen only when no board scoped one", async () => {
    server = serveFolder({ boards: {}, screens: ["home", "pricing"], defaultScreen: "pricing" });
    await boot();
    expect(useCanvas.getState().currentBoardId).toBeNull();
    expect(useCanvas.getState().currentScreenId).toBe("pricing");
  });

  test("records a boot failure instead of throwing, and clears it on success", async () => {
    server.fail("/api/design", 503);
    await boot();
    expect(useCanvas.getState().design).toBeNull();
    expect(useCanvas.getState().bootError).toContain("503");
    server.clearFailures();
    await boot();
    expect(useCanvas.getState().bootError).toBeNull();
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });
});

describe("selectBoard", () => {
  beforeEach(async () => {
    await boot();
  });

  test("coerces the screen when the current one isn't on the new board", async () => {
    await useCanvas.getState().selectBoard("docs");
    expect(useCanvas.getState().currentScreenId).toBe("guide");
  });

  test("keeps the screen when the new board also shows it", async () => {
    server.boards.docs = {
      ...(server.boards.docs as Board),
      frames: [{ id: frameId("docs"), screen: "home", x: 0, y: 0, w: 400, h: 300 }],
    } as Board;
    useCanvas.setState({ boards: {} });
    await useCanvas.getState().selectBoard("docs");
    expect(useCanvas.getState().currentScreenId).toBe("home");
  });

  test("clears the screen for an empty board", async () => {
    server.boards.empty = { id: "empty", name: "empty", frames: [] } as unknown as Board;
    await useCanvas.getState().selectBoard("empty");
    expect(useCanvas.getState().currentScreenId).toBeNull();
  });

  test("remembers the board for next time", async () => {
    restoreStorage = stubLocalStorage();
    await useCanvas.getState().selectBoard("docs");
    expect(localStorage.getItem("velloo:lastBoard")).toBe("docs");
  });

  test("an unknown board id leaves the canvas where it was", async () => {
    await useCanvas.getState().selectBoard("nope");
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });
});

describe("refreshBoard", () => {
  beforeEach(async () => {
    await boot();
  });

  test("syncs the summary's name and frame count", async () => {
    server.boards.main = { ...(server.boards.main as Board), name: "Renamed" } as Board;
    await useCanvas.getState().refreshBoard("main");
    const meta = useCanvas.getState().design?.boards.find((b) => b.id === "main");
    expect(meta?.name).toBe("Renamed");
    expect(meta?.frameCount).toBe(2);
  });

  test("loads a screen the board has newly come to reference", async () => {
    server.screens.about = screenFixture("about");
    const main = server.boards.main as Board;
    server.boards.main = {
      ...main,
      frames: [
        ...main.frames,
        { id: frameId("main", 2), screen: "about", x: 0, y: 0, w: 400, h: 300 },
      ],
    } as Board;
    await useCanvas.getState().refreshBoard("main");
    expect(useCanvas.getState().screens.about).toBeDefined();
  });

  test("prunes a board the server no longer lists", async () => {
    delete server.boards.docs;
    server.design.boards = server.design.boards.filter((b) => b.id !== "docs");
    await useCanvas.getState().loadBoard("docs");
    await useCanvas.getState().refreshBoard("docs");
    expect(useCanvas.getState().design?.boards.map((b) => b.id)).toEqual(["main"]);
  });

  test("keeps a board the summary still lists — a fetch can just fail", async () => {
    server.fail("/api/board/docs", 500);
    await useCanvas.getState().refreshBoard("docs");
    expect(useCanvas.getState().design?.boards.map((b) => b.id)).toEqual(["main", "docs"]);
  });
});

describe("boards leaving the canvas", () => {
  beforeEach(async () => {
    await boot();
  });

  test("pruning the active board moves to the first remaining one", async () => {
    server.design.boards = server.design.boards.filter((b) => b.id !== "main");
    await useCanvas.getState().pruneBoard("main");
    expect(useCanvas.getState().currentBoardId).toBe("docs");
    expect(useCanvas.getState().currentScreenId).toBe("guide");
  });

  test("pruning the last board clears the canvas", async () => {
    server = serveFolder({ boards: { only: ["home"] } });
    resetStore();
    await boot();
    await useCanvas.getState().pruneBoard("only");
    expect(useCanvas.getState().currentBoardId).toBeNull();
    expect(useCanvas.getState().currentScreenId).toBeNull();
  });

  test("archiving the board you're looking at moves the selection", async () => {
    server.design.boards = server.design.boards.filter((b) => b.id !== "main");
    await useCanvas.getState().setBoardArchived("main", true);
    expect(useCanvas.getState().currentBoardId).toBe("docs");
  });

  test("archiving another board leaves the selection alone", async () => {
    server.design.boards = server.design.boards.filter((b) => b.id !== "docs");
    await useCanvas.getState().setBoardArchived("docs", true);
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });

  test("archiving the last live board clears the canvas", async () => {
    server.design.boards = [];
    await useCanvas.getState().setBoardArchived("main", true);
    expect(useCanvas.getState().currentBoardId).toBeNull();
    expect(useCanvas.getState().notes).toEqual([]);
  });
});

describe("reorderBoardsLocal", () => {
  test("reorders to match, keeping unnamed boards at the end", async () => {
    server = serveFolder({ boards: { a: ["s"], b: ["s"], c: ["s"] } });
    await boot();
    useCanvas.getState().reorderBoardsLocal(["c", "a"]);
    expect(useCanvas.getState().design?.boards.map((b) => b.id)).toEqual(["c", "a", "b"]);
  });

  test("ignores ids that aren't boards", async () => {
    await boot();
    useCanvas.getState().reorderBoardsLocal(["ghost", "docs"]);
    expect(useCanvas.getState().design?.boards.map((b) => b.id)).toEqual(["docs", "main"]);
  });
});

describe("screen render versions", () => {
  test("a refresh bumps only the screen that changed", async () => {
    await boot();
    const before = { ...useCanvas.getState().screenVersions };
    await useCanvas.getState().refreshScreen("home");
    const after = useCanvas.getState().screenVersions;
    expect(after.home).toBe((before.home ?? 0) + 1);
    expect(after.pricing).toBe(before.pricing);
  });

  test("a screen that can no longer be fetched falls back to a full reload", async () => {
    await boot();
    server.fail("/api/screen/", 404);
    const before = server.calls.length;
    await useCanvas.getState().refreshScreen("home");
    expect(server.calls.slice(before)).toContain("/api/design");
  });
});

describe("connection state", () => {
  test("wsEverConnected latches once the socket has been up", () => {
    const { setWsConnected } = useCanvas.getState();
    expect(useCanvas.getState().wsEverConnected).toBe(false);
    setWsConnected(true);
    setWsConnected(false);
    expect(useCanvas.getState().wsConnected).toBe(false);
    expect(useCanvas.getState().wsEverConnected).toBe(true);
  });
});

describe("resyncAfterReconnect", () => {
  test("refreshes the summary, theme, history and the board on screen", async () => {
    await boot();
    const before = server.calls.length;
    await useCanvas.getState().resyncAfterReconnect();
    const calls = server.calls.slice(before);
    expect(calls).toContain("/api/design");
    expect(calls).toContain("/api/theme");
    expect(calls).toContain("/api/undo");
    expect(calls).toContain("/api/board/main");
  });

  test("re-renders every cached screen, so stale iframes reload", async () => {
    await boot();
    const before = { ...useCanvas.getState().screenVersions };
    await useCanvas.getState().resyncAfterReconnect();
    const after = useCanvas.getState().screenVersions;
    expect(after.home).toBeGreaterThan(before.home ?? 0);
    expect(after.pricing).toBeGreaterThan(before.pricing ?? 0);
  });

  test("skips synthetic snippet screens — they aren't on disk", async () => {
    await boot();
    useCanvas.setState({
      screens: { ...useCanvas.getState().screens, "snippet:card": screenFixture("snippet:card") },
    });
    const before = server.calls.length;
    await useCanvas.getState().resyncAfterReconnect();
    expect(server.calls.slice(before).join("|")).not.toContain("snippet");
  });

  test("is best-effort: a daemon still coming up doesn't throw", async () => {
    await boot();
    server.fail("/api/", 503);
    await useCanvas.getState().resyncAfterReconnect();
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });
});

describe("reloadAll", () => {
  test("drops every cache and keeps a board that still exists", async () => {
    await boot();
    await useCanvas.getState().reloadAll();
    expect(useCanvas.getState().currentBoardId).toBe("main");
    expect(useCanvas.getState().currentScreenId).toBe("home");
  });

  test("clears a board and screen that the rewrite removed", async () => {
    await boot();
    await useCanvas.getState().selectBoard("docs");
    delete server.boards.docs;
    server.design.boards = server.design.boards.filter((b) => b.id !== "docs");
    server.design.screens = server.design.screens.filter((s) => s.id !== "guide");
    await useCanvas.getState().reloadAll();
    expect(useCanvas.getState().currentBoardId).toBe("main");
    expect(useCanvas.getState().currentScreenId).toBe("home");
  });
});

describe("the theme follows the board", () => {
  test("a board that pins a theme is edited in that theme, not the default", async () => {
    server = serveFolder({
      boards: { main: ["home"], dark: ["home"] },
      boardThemes: { dark: "midnight" },
    });
    await boot();
    expect(useCanvas.getState().themeName).toBe("default");
    await useCanvas.getState().selectBoard("dark");
    expect(useCanvas.getState().themeName).toBe("midnight");
  });

  test("syncThemeToBoard is a no-op before boot has loaded one", async () => {
    const before = server.calls.length;
    await useCanvas.getState().syncThemeToBoard();
    expect(server.calls.slice(before)).toEqual([]);
  });
});

describe("lazily loaded folder data", () => {
  test("the components manifest is fetched once and reused", async () => {
    await useCanvas.getState().loadComponents();
    await useCanvas.getState().loadComponents();
    expect(server.calls.filter((c) => c === "/api/components")).toHaveLength(1);
  });

  test("two callers racing the first load still make one request", async () => {
    // Opening the snippet editor asks for the manifest from the store action
    // and again from the view's mount effect, in the same tick.
    await Promise.all([
      useCanvas.getState().loadComponents(),
      useCanvas.getState().loadComponents(),
    ]);
    expect(server.calls.filter((c) => c === "/api/components")).toHaveLength(1);
  });

  test("the in-flight flag distinguishes a loading library from an empty one", async () => {
    expect(useCanvas.getState().componentsLoading).toBe(false);
    const pending = useCanvas.getState().loadComponents();
    expect(useCanvas.getState().componentsLoading).toBe(true);
    await pending;
    expect(useCanvas.getState().componentsLoading).toBe(false);
  });

  test("a failed manifest fetch clears the flag, so the shelf isn't stuck loading", async () => {
    server.fail("/api/components", 500);
    await expect(useCanvas.getState().loadComponents()).rejects.toThrow();
    expect(useCanvas.getState().componentsLoading).toBe(false);
    expect(useCanvas.getState().components).toBeNull();
  });

  test("asset provenance is an enhancement — a folder without it still works", async () => {
    server.fail("/api/assets", 404);
    await useCanvas.getState().loadGeneratedAssets();
    expect(useCanvas.getState().generatedAssets).toEqual({});
  });
});
