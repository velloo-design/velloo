import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { domSuite } from "./dom.ts";
import { type FakeServer, serveFolder, snippetFixture } from "./fake-server.ts";

/**
 * The live-sync transport: 149 lines that decide, for every push the daemon
 * sends, whether the canvas refetches and what. It had no test at all, and the
 * cost of a wrong branch is invisible — a stale board that simply never
 * updates, or a refetch storm nobody notices until the folder is large.
 *
 * The socket is faked rather than a real server so each frame can be delivered
 * on demand; the routing under test is entirely client-side.
 */

const toasts: { title?: string; message: string }[] = [];
mock.module("../toast.ts", () => ({
  pushToast: (t: { title?: string; message: string }) => {
    toasts.push(t);
    return "toast";
  },
  toastError: (_err: unknown, fallback: string) => {
    toasts.push({ message: fallback });
    return "toast";
  },
}));

const { connectWs } = await import("../ws-client.ts");
const { useCanvas } = await import("../store.ts");
const { ensureConnected } = await import("../api/connection.ts");

type Handler = ((ev: unknown) => void) | null;

class FakeSocket {
  static live: FakeSocket[] = [];
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.live.push(this);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({});
  }

  /** Complete the handshake, as the daemon accepting the connection does. */
  accept(): void {
    this.onopen?.({});
  }

  /** Deliver one raw socket frame. */
  deliver(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }
}

const socket = (): FakeSocket => {
  const last = FakeSocket.live.at(-1);
  if (!last) throw new Error("no socket was opened");
  return last;
};

let server: FakeServer;
let disconnect: (() => void) | null = null;
let timers: { fn: () => void; ms: number }[] = [];
const realWebSocket = globalThis.WebSocket;
const realSetTimeout = globalThis.setTimeout;

/** Capture the reconnect schedule instead of waiting it out. */
function captureTimers(): void {
  timers = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    timers.push({ fn, ms: ms ?? 0 });
    return 0;
  }) as unknown as typeof setTimeout;
}

/** Let the store's fire-and-forget refreshes finish before asserting. */
const flush = () => Bun.sleep(15);

beforeEach(() => {
  toasts.length = 0;
  FakeSocket.live = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  server = serveFolder({ boards: { main: ["home", "pricing"], docs: ["guide"] } });
  useCanvas.setState({
    design: null,
    screens: {},
    boards: {},
    currentBoardId: null,
    currentScreenId: null,
    folderConfig: null,
    wsConnected: false,
    wsEverConnected: false,
    bootError: null,
    activityEvents: [],
    activityFlash: {},
    frameGlow: {},
    boardPulse: {},
    editingSnippetId: null,
    snippetFocus: null,
  });
});

afterEach(() => {
  disconnect?.();
  disconnect = null;
  globalThis.WebSocket = realWebSocket;
  globalThis.setTimeout = realSetTimeout;
  server.restore();
});

/** A connected canvas with `main` open, as a real session would be. */
async function connectedSession(): Promise<void> {
  await useCanvas.getState().loadDesign();
  disconnect = connectWs();
  socket().accept();
  await flush();
  server.calls.length = 0;
}

domSuite("frame routing", () => {
  beforeEach(async () => {
    await connectedSession();
  });

  test("a changed screen the canvas holds is refetched", async () => {
    socket().deliver({ type: "screen-changed", screenId: "home" });
    await flush();
    expect(server.calls).toContain("/api/screen/home");
  });

  test("a screen the canvas has never loaded refreshes the summary instead", async () => {
    socket().deliver({ type: "screen-changed", screenId: "brand-new" });
    await flush();
    expect(server.calls).toContain("/api/design");
    expect(server.calls).not.toContain("/api/screen/brand-new");
  });

  test("a changed board the canvas holds is refetched", async () => {
    socket().deliver({ type: "board-changed", boardId: "main" });
    await flush();
    expect(server.calls).toContain("/api/board/main");
  });

  test("a board the canvas has never loaded refreshes the summary instead", async () => {
    socket().deliver({ type: "board-changed", boardId: "docs" });
    await flush();
    expect(server.calls).toContain("/api/design");
    expect(server.calls).not.toContain("/api/board/docs");
  });

  test("a theme change refetches the theme", async () => {
    socket().deliver({ type: "theme-changed" });
    await flush();
    expect(server.calls).toContain("/api/theme");
  });

  test("every watch event also refreshes the undo depths", async () => {
    socket().deliver({ type: "theme-changed" });
    await flush();
    expect(server.calls).toContain("/api/undo");
  });

  test("annotations refresh when any frame on the board shows that screen", async () => {
    socket().deliver({ type: "annotations-changed", screenId: "pricing" });
    await flush();
    expect(server.calls.some((c) => c.startsWith("/api/annotations/"))).toBe(true);
  });

  test("annotations on a screen this board doesn't show are ignored", async () => {
    socket().deliver({ type: "annotations-changed", screenId: "guide" });
    await flush();
    expect(server.calls.some((c) => c.startsWith("/api/annotations/"))).toBe(false);
  });

  test("notes and comments only refresh for the board on screen", async () => {
    socket().deliver({ type: "notes-changed", boardId: "docs" });
    socket().deliver({ type: "comments-changed", boardId: "docs", scope: "local" });
    await flush();
    expect(server.calls.some((c) => c.startsWith("/api/notes/"))).toBe(false);
    expect(server.calls.some((c) => c.startsWith("/api/comments"))).toBe(false);
    socket().deliver({ type: "notes-changed", boardId: "main" });
    socket().deliver({ type: "comments-changed", boardId: "main", scope: "local" });
    await flush();
    expect(server.calls.some((c) => c.startsWith("/api/notes/"))).toBe(true);
    expect(server.calls.some((c) => c.startsWith("/api/comments"))).toBe(true);
  });

  test("a config change reloads the settings dialog only when it's open", async () => {
    socket().deliver({ type: "config-changed" });
    await flush();
    expect(server.calls).toContain("/api/design");
    expect(server.calls).not.toContain("/api/config");
    await useCanvas.getState().loadFolderConfig();
    server.calls.length = 0;
    socket().deliver({ type: "config-changed" });
    await flush();
    expect(server.calls).toContain("/api/config");
  });

  test("a changed snippet refreshes the summary and the screen showing it", async () => {
    socket().deliver({ type: "snippet-changed", snippetId: "card" });
    await flush();
    expect(server.calls).toContain("/api/design");
    expect(server.calls).toContain("/api/screen/home");
  });

  test("the snippet open in the editor has its definition re-pulled", async () => {
    server.snippets.card = snippetFixture("card");
    useCanvas.setState({ editingSnippetId: "card" });
    socket().deliver({ type: "snippet-changed", snippetId: "card" });
    await flush();
    expect(server.calls).toContain("/api/snippets/card");
    expect(useCanvas.getState().screens["snippet:card"]).toBeDefined();
  });

  test("a snippet focused in place on a board is re-pulled too", async () => {
    server.snippets.card = snippetFixture("card");
    useCanvas.setState({ snippetFocus: "card" });
    socket().deliver({ type: "snippet-changed", snippetId: "card" });
    await flush();
    expect(useCanvas.getState().screens["snippet:card"]).toBeDefined();
  });

  test("a snippet nobody is editing isn't fetched", async () => {
    server.snippets.card = snippetFixture("card");
    socket().deliver({ type: "snippet-changed", snippetId: "card" });
    await flush();
    expect(server.calls).not.toContain("/api/snippets/card");
  });

  test("a snippet deleted mid-edit leaves the editor standing", async () => {
    useCanvas.setState({ editingSnippetId: "gone" });
    socket().deliver({ type: "snippet-changed", snippetId: "gone" });
    await flush();
    expect(useCanvas.getState().screens["snippet:gone"]).toBeUndefined();
  });

  test("a folder rewritten out of band boots the canvas again", async () => {
    socket().deliver({ type: "folder-reloaded" });
    await flush();
    expect(server.calls).toContain("/api/design");
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });

  test("a file that failed to reload is surfaced, not swallowed", async () => {
    socket().deliver({ type: "reload-error", source: "screens/home.json", message: "bad JSON" });
    await flush();
    expect(toasts.at(-1)?.message).toContain("screens/home.json");
    expect(toasts.at(-1)?.message).toContain("bad JSON");
  });
});

domSuite("frames the client can't use", () => {
  beforeEach(async () => {
    await connectedSession();
  });

  test("an event type this build predates is ignored, not fatal", async () => {
    socket().deliver({ type: "something-new-in-a-later-daemon", detail: 1 });
    await flush();
    expect(server.calls).toEqual([]);
  });

  test("malformed payloads are dropped", async () => {
    socket().deliver("not json at all");
    socket().deliver({ type: "screen-changed" }); // no screenId
    socket().deliver({ type: 42 });
    socket().onmessage?.({ data: { type: "screen-changed", screenId: "home" } });
    await flush();
    expect(server.calls).toEqual([]);
  });
});

domSuite("activity frames", () => {
  beforeEach(async () => {
    await connectedSession();
  });

  test("are recorded for the feed and never trigger a refetch", async () => {
    socket().deliver({
      type: "activity",
      id: 1,
      ts: 1_700_000_000_000,
      verb: "update_props",
      source: "mcp",
      target: { screenId: "home" },
    });
    await flush();
    expect(useCanvas.getState().activityEvents).toHaveLength(1);
    expect(server.calls).toEqual([]);
  });

  test("a malformed activity frame is dropped rather than poisoning the feed", async () => {
    socket().deliver({ type: "activity", id: "not-a-number" });
    await flush();
    expect(useCanvas.getState().activityEvents).toEqual([]);
  });
});

domSuite("connection lifecycle", () => {
  test("accepting the socket un-gates the API layer", async () => {
    await useCanvas.getState().loadDesign();
    disconnect = connectWs();
    socket().accept();
    await flush();
    expect(useCanvas.getState().wsConnected).toBe(true);
    expect(() => ensureConnected()).not.toThrow();
  });

  test("a drop pauses edits rather than letting them silently no-op", async () => {
    await connectedSession();
    socket().close();
    expect(useCanvas.getState().wsConnected).toBe(false);
    expect(useCanvas.getState().wsEverConnected).toBe(true);
    expect(() => ensureConnected()).toThrow(/Disconnected/);
  });

  test("a socket error closes the connection so the retry loop takes over", async () => {
    await connectedSession();
    captureTimers();
    socket().onerror?.({});
    expect(socket().closed).toBe(true);
    expect(useCanvas.getState().wsConnected).toBe(false);
    expect(timers.shift()?.ms).toBe(250);
  });

  test("a boot that failed retries in full on the first connect", async () => {
    server.fail("/api/design", 503);
    await useCanvas.getState().loadDesign();
    expect(useCanvas.getState().bootError).not.toBeNull();
    server.clearFailures();
    disconnect = connectWs();
    socket().accept();
    await flush();
    expect(useCanvas.getState().bootError).toBeNull();
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });

  test("a first connect on a healthy boot doesn't resync anything", async () => {
    await useCanvas.getState().loadDesign();
    server.calls.length = 0;
    disconnect = connectWs();
    socket().accept();
    await flush();
    expect(server.calls).toEqual([]);
  });

  test("an established session refetches everything after a drop", async () => {
    await connectedSession();
    socket().close();
    captureTimers();
    timers.shift()?.fn(); // the scheduled reconnect
    server.calls.length = 0;
    socket().accept();
    await flush();
    expect(server.calls).toContain("/api/design");
    expect(server.calls).toContain("/api/board/main");
    expect(server.calls).toContain("/api/screen/home");
  });
});

domSuite("reconnect backoff", () => {
  test("retries with a growing delay, capped so it never gives up", async () => {
    await connectedSession();
    captureTimers();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      socket().close();
      const scheduled = timers.shift();
      if (!scheduled) throw new Error("no reconnect was scheduled");
      delays.push(scheduled.ms);
      scheduled.fn();
    }
    expect(delays.slice(0, 4)).toEqual([250, 500, 1000, 2000]);
    expect(delays.at(-1)).toBe(5000);
    expect(Math.max(...delays)).toBe(5000);
  });

  test("a successful connect resets the backoff", async () => {
    await connectedSession();
    captureTimers();
    socket().close();
    const first = timers.shift();
    expect(first?.ms).toBe(250);
    first?.fn();
    socket().close();
    const second = timers.shift();
    expect(second?.ms).toBe(500);
    second?.fn();
    // This attempt lands, so the next drop starts over at the short delay.
    socket().accept();
    await flush();
    socket().close();
    expect(timers.shift()?.ms).toBe(250);
  });

  test("unmounting stops the retry loop for good", async () => {
    await connectedSession();
    captureTimers();
    disconnect?.();
    disconnect = null;
    expect(timers).toEqual([]);
    expect(socket().closed).toBe(true);
  });
});
