import { afterEach, beforeEach, expect, test } from "bun:test";
import { domSuite } from "./dom.ts";
import { frameId, serveFolder } from "./fake-server.ts";

/**
 * The camera. Every value here is one the user feels rather than reads, which
 * is why it drifts unnoticed: a zoom that ratchets, a fly-to that fights a
 * wheel gesture, a saved view that never comes back. The animated paths are
 * driven through a fake clock so the easing settles deterministically instead
 * of being waited out.
 */

const { useCanvas } = await import("../store.ts");
const { MAX_ZOOM, MIN_ZOOM } = await import("../board-geometry.ts");

const VW = 1000;
const VH = 800;

let clock = 0;
let pending: FrameRequestCallback[] = [];
let wrapper: HTMLElement | null = null;
let server: ReturnType<typeof serveFolder>;

const realRaf = globalThis.requestAnimationFrame;
const realNow = globalThis.performance.now.bind(globalThis.performance);

/** Run every queued frame at the advanced time; tweens queue their next here. */
function advance(ms: number): void {
  clock += ms;
  for (const cb of pending.splice(0)) cb(clock);
}

/** Advance until no tween is left running. */
function settleFlight(): void {
  for (let i = 0; i < 50 && pending.length > 0; i++) advance(100);
}

/** Put a board viewport on screen — `boardWrapper()` reads it from the DOM. */
function mountWrapper(w = VW, h = VH): void {
  wrapper = document.createElement("div");
  wrapper.setAttribute("data-velloo-board", "true");
  Object.defineProperty(wrapper, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(wrapper, "clientHeight", { value: h, configurable: true });
  document.body.appendChild(wrapper);
}

const view = () => ({ zoom: useCanvas.getState().canvasZoom, pan: useCanvas.getState().pan });

beforeEach(() => {
  clock = 0;
  pending = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    pending.push(cb)) as unknown as typeof requestAnimationFrame;
  globalThis.performance.now = () => clock;
  server = serveFolder({ boards: { main: ["home"], docs: ["guide"] } });
  useCanvas.setState({
    canvasZoom: 1,
    pan: { x: 0, y: 0 },
    cursorMode: "select",
    nodeRects: {},
    frameInsets: {},
    rectProbe: null,
    hover: null,
    selection: null,
    reveal: null,
    editingMarkupId: null,
    currentBoardId: "main",
    currentScreenId: "home",
    boards: {
      main: {
        id: "main",
        name: "main",
        frames: [{ id: frameId("main"), screen: "home", x: 200, y: 100, w: 400, h: 300 }],
      },
    } as never,
    screens: {},
  });
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.performance.now = realNow;
  wrapper?.remove();
  wrapper = null;
  server.restore();
});

domSuite("setCanvasZoom / setPan", () => {
  test("zoom is clamped to the range the board can actually render", () => {
    useCanvas.getState().setCanvasZoom(99);
    expect(useCanvas.getState().canvasZoom).toBe(MAX_ZOOM);
    useCanvas.getState().setCanvasZoom(0);
    expect(useCanvas.getState().canvasZoom).toBe(MIN_ZOOM);
  });

  test("a wheel mid-flight wins instantly instead of fighting the tween", () => {
    mountWrapper();
    useCanvas.getState().flyToFrame(frameId("main"));
    advance(100); // partway through the glide
    useCanvas.getState().setCanvasZoom(2);
    settleFlight();
    expect(useCanvas.getState().canvasZoom).toBe(2);
  });

  test("a drag mid-flight cancels it too", () => {
    mountWrapper();
    useCanvas.getState().flyToFrame(frameId("main"));
    advance(100);
    useCanvas.getState().setPan({ x: 7, y: 9 });
    settleFlight();
    expect(useCanvas.getState().pan).toEqual({ x: 7, y: 9 });
  });

  test("switching tool drops the hover — it belongs to the old cursor", () => {
    useCanvas.setState({ hover: { screenId: "home", path: "0" } });
    useCanvas.getState().setCursorMode("hand");
    expect(useCanvas.getState().cursorMode).toBe("hand");
    expect(useCanvas.getState().hover).toBeNull();
  });
});

domSuite("zoomAtViewportCenter", () => {
  test("keeps the world point under the viewport center fixed", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 1, pan: { x: 0, y: 0 } });
    const worldBefore = (VW / 2 - 0) / 1;
    useCanvas.getState().zoomAtViewportCenter({ factor: 2 });
    const { zoom, pan } = view();
    expect(zoom).toBe(2);
    expect((VW / 2 - pan.x) / zoom).toBeCloseTo(worldBefore, 6);
  });

  test("an absolute zoom is reached the same way as a factor", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 0.5, pan: { x: 0, y: 0 } });
    useCanvas.getState().zoomAtViewportCenter({ zoom: 1 });
    expect(useCanvas.getState().canvasZoom).toBeCloseTo(1, 6);
  });

  test("with no board on screen it still zooms, just without an anchor", () => {
    useCanvas.setState({ canvasZoom: 1, pan: { x: 3, y: 4 } });
    useCanvas.getState().zoomAtViewportCenter({ factor: 2 });
    expect(view()).toEqual({ zoom: 2, pan: { x: 3, y: 4 } });
    useCanvas.getState().zoomAtViewportCenter({ zoom: 99 });
    expect(useCanvas.getState().canvasZoom).toBe(MAX_ZOOM);
  });

  test("already at the limit, nothing moves", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: MAX_ZOOM, pan: { x: 5, y: 5 } });
    useCanvas.getState().zoomAtViewportCenter({ factor: 2 });
    expect(view()).toEqual({ zoom: MAX_ZOOM, pan: { x: 5, y: 5 } });
  });
});

domSuite("framing a frame", () => {
  test("centerOnFrame jumps; flyToFrame glides to the same place", () => {
    mountWrapper();
    useCanvas.getState().centerOnFrame(frameId("main"));
    const jumped = view();
    useCanvas.setState({ canvasZoom: 0.2, pan: { x: -900, y: -900 } });
    useCanvas.getState().flyToFrame(frameId("main"));
    settleFlight();
    expect(useCanvas.getState().canvasZoom).toBeCloseTo(jumped.zoom, 6);
    expect(useCanvas.getState().pan.x).toBeCloseTo(jumped.pan.x, 6);
    expect(useCanvas.getState().pan.y).toBeCloseTo(jumped.pan.y, 6);
  });

  test("a frame id that isn't on the board is a no-op", () => {
    mountWrapper();
    const before = view();
    useCanvas.getState().centerOnFrame("ghost");
    useCanvas.getState().flyToFrame("ghost");
    settleFlight();
    expect(view()).toEqual(before);
  });

  test("no board viewport (library view) leaves the camera alone", () => {
    const before = view();
    useCanvas.getState().centerOnFrame(frameId("main"));
    useCanvas.getState().flyToBoardRect({ x: 0, y: 0, w: 100, h: 100 });
    expect(view()).toEqual(before);
  });

  test("flyToBoardRect glides to an exact world rect", () => {
    mountWrapper();
    useCanvas.getState().flyToBoardRect({ x: 0, y: 0, w: 200, h: 200 });
    settleFlight();
    // The rect's center lands on the viewport center.
    const { zoom, pan } = view();
    expect(100 * zoom + pan.x).toBeCloseTo(VW / 2, 0);
    expect(100 * zoom + pan.y).toBeCloseTo(VH / 2, 0);
  });
});

domSuite("the markup-edit soft zoom", () => {
  // The remembered camera is module state that outlives the store, so a test
  // that opens an edit and never closes it would hand its view to the next one.
  afterEach(() => {
    useCanvas.getState().restoreViewAfterMarkupEdit();
    settleFlight();
  });

  test("zooms to 100% and glides back to the camera you had", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 0.4, pan: { x: 120, y: 60 } });
    const before = view();
    useCanvas.getState().zoomForMarkupEdit();
    settleFlight();
    expect(useCanvas.getState().canvasZoom).toBeCloseTo(1, 6);
    useCanvas.getState().restoreViewAfterMarkupEdit();
    settleFlight();
    expect(useCanvas.getState().canvasZoom).toBeCloseTo(before.zoom, 6);
    expect(useCanvas.getState().pan.x).toBeCloseTo(before.pan.x, 6);
  });

  test("already at 100%: nothing animates, but the view is still remembered", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 1, pan: { x: 10, y: 20 } });
    useCanvas.getState().zoomForMarkupEdit();
    expect(pending).toHaveLength(0);
    useCanvas.setState({ canvasZoom: 0.5, pan: { x: 0, y: 0 } });
    useCanvas.getState().restoreViewAfterMarkupEdit();
    settleFlight();
    expect(useCanvas.getState().canvasZoom).toBeCloseTo(1, 6);
  });

  test("panning during the edit keeps the pre-edit view to return to", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 0.4, pan: { x: 120, y: 60 }, editingMarkupId: "note-1" });
    useCanvas.getState().zoomForMarkupEdit();
    settleFlight();
    useCanvas.getState().setPan({ x: 500, y: 500 });
    useCanvas.getState().restoreViewAfterMarkupEdit();
    settleFlight();
    expect(useCanvas.getState().canvasZoom).toBeCloseTo(0.4, 6);
    expect(useCanvas.getState().pan.x).toBeCloseTo(120, 6);
  });

  /**
   * A comment draft frames two things at once: the box being commented on, in
   * board space, and the composer beside it, which counter-scales out of the
   * board zoom and so measures in screen px. Both have to land whole — the bug
   * this replaces framed only the composer and left the camera far enough over
   * that half of it hung off the edge.
   */
  const COMPOSER = { w: 384, h: 220, gap: 14 };

  /** Where the anchor and the composer end up on screen, in canvas px. */
  function draftOnScreen(anchor: { x: number; y: number; w: number; h: number }) {
    const { zoom, pan } = view();
    const ax = anchor.x * zoom + pan.x;
    const ay = anchor.y * zoom + pan.y;
    return {
      zoom,
      anchor: { left: ax, top: ay, right: ax + anchor.w * zoom, bottom: ay + anchor.h * zoom },
      composer: {
        left: ax + anchor.w * zoom + COMPOSER.gap,
        top: ay + COMPOSER.gap,
        right: ax + anchor.w * zoom + COMPOSER.gap + COMPOSER.w,
        bottom: ay + COMPOSER.gap + COMPOSER.h,
      },
    };
  }

  function expectOnScreen(
    seen: { left: number; top: number; right: number; bottom: number },
    vw = VW,
    vh = VH,
  ) {
    expect(seen.left).toBeGreaterThanOrEqual(0);
    expect(seen.top).toBeGreaterThanOrEqual(0);
    expect(seen.right).toBeLessThanOrEqual(vw);
    expect(seen.bottom).toBeLessThanOrEqual(vh);
  }

  test("a pin far off-camera brings both the pin and the composer into view", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 0.3, pan: { x: 0, y: 0 } });
    const pin = { x: 2400, y: 1800, w: 0, h: 0 };
    useCanvas.getState().zoomForCommentDraft(pin, COMPOSER);
    settleFlight();
    const seen = draftOnScreen(pin);
    expect(seen.zoom).toBeCloseTo(1, 6);
    expectOnScreen(seen.anchor);
    expectOnScreen(seen.composer);
  });

  test("a node too wide for the leftover room zooms out instead of hiding one", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 1, pan: { x: 0, y: 0 } });
    const node = { x: 200, y: 100, w: 1440, h: 900 };
    useCanvas.getState().zoomForCommentDraft(node, COMPOSER);
    settleFlight();
    const seen = draftOnScreen(node);
    expect(seen.zoom).toBeLessThan(1);
    expectOnScreen(seen.anchor);
    expectOnScreen(seen.composer);
  });

  /**
   * Starting a draft reveals the comments pane, and the pane's width animates
   * over ~200ms. Framing against the viewport as it stood when the draft
   * opened left the composer hanging past the right edge — but only on the
   * first comment of a session, because after that the pane is already open.
   */
  test("waits for a revealing pane to finish narrowing the viewport", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 1, pan: { x: 0, y: 0 } });
    const pin = { x: 2400, y: 1800, w: 0, h: 0 };
    useCanvas.getState().zoomForCommentDraft(pin, COMPOSER);
    const narrow = VW - 320;
    Object.defineProperty(wrapper, "clientWidth", { value: narrow, configurable: true });
    settleFlight();
    const seen = draftOnScreen(pin);
    expectOnScreen(seen.anchor, narrow);
    expectOnScreen(seen.composer, narrow);
  });

  test("a draft closed before the flight departs doesn't move the camera at all", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 0.4, pan: { x: 120, y: 60 } });
    useCanvas.getState().zoomForCommentDraft({ x: 2400, y: 1800, w: 0, h: 0 }, COMPOSER);
    useCanvas.getState().restoreViewAfterMarkupEdit();
    settleFlight();
    expect(view()).toEqual({ zoom: 0.4, pan: { x: 120, y: 60 } });
  });

  test("it remembers the camera, so closing the draft glides back", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 0.4, pan: { x: 120, y: 60 } });
    useCanvas.getState().zoomForCommentDraft({ x: 900, y: 700, w: 80, h: 40 }, COMPOSER);
    settleFlight();
    useCanvas.getState().restoreViewAfterMarkupEdit();
    settleFlight();
    expect(useCanvas.getState().canvasZoom).toBeCloseTo(0.4, 6);
    expect(useCanvas.getState().pan).toEqual({ x: 120, y: 60 });
  });

  test("a camera move outside an edit forgets the saved view", () => {
    mountWrapper();
    useCanvas.setState({ canvasZoom: 0.4, pan: { x: 120, y: 60 } });
    useCanvas.getState().zoomForMarkupEdit();
    settleFlight();
    useCanvas.getState().setPan({ x: 500, y: 500 });
    useCanvas.getState().restoreViewAfterMarkupEdit();
    settleFlight();
    expect(useCanvas.getState().pan).toEqual({ x: 500, y: 500 });
  });
});

domSuite("reported geometry", () => {
  const rect = (path: string, x = 0) => ({ path, x, y: 0, w: 10, h: 10 });

  test("rects are per frame, so sibling frames don't clobber each other", () => {
    const { setNodeRects } = useCanvas.getState();
    setNodeRects("f1", [rect("0")]);
    setNodeRects("f2", [rect("0", 99)]);
    expect(useCanvas.getState().nodeRects.f1?.["0"]?.x).toBe(0);
    expect(useCanvas.getState().nodeRects.f2?.["0"]?.x).toBe(99);
  });

  test("a fresh report replaces that frame's set rather than merging", () => {
    const { setNodeRects } = useCanvas.getState();
    setNodeRects("f1", [rect("0"), rect("1")]);
    setNodeRects("f1", [rect("0")]);
    expect(Object.keys(useCanvas.getState().nodeRects.f1 ?? {})).toEqual(["0"]);
  });

  test("clearing drops one frame and leaves an unknown frame untouched", () => {
    const { setNodeRects, clearNodeRects } = useCanvas.getState();
    setNodeRects("f1", [rect("0")]);
    setNodeRects("f2", [rect("0")]);
    clearNodeRects("f1");
    expect(Object.keys(useCanvas.getState().nodeRects)).toEqual(["f2"]);
    const before = useCanvas.getState().nodeRects;
    clearNodeRects("ghost");
    expect(useCanvas.getState().nodeRects).toBe(before);
  });

  test("an unchanged inset measurement doesn't re-render the board", () => {
    const inset = { x: 0, y: 40, chromeH: 60 };
    useCanvas.getState().setFrameInset("f1", inset);
    const first = useCanvas.getState().frameInsets;
    // A ResizeObserver reports the same numbers constantly.
    useCanvas.getState().setFrameInset("f1", { ...inset });
    expect(useCanvas.getState().frameInsets).toBe(first);
    useCanvas.getState().setFrameInset("f1", { ...inset, chromeH: 61 });
    expect(useCanvas.getState().frameInsets).not.toBe(first);
  });

  test("an unmounting frame drops its measurement", () => {
    useCanvas.getState().setFrameInset("f1", { x: 0, y: 40, chromeH: 60 });
    useCanvas.getState().setFrameInset("f1", null);
    expect(useCanvas.getState().frameInsets).toEqual({});
    const before = useCanvas.getState().frameInsets;
    useCanvas.getState().setFrameInset("ghost", null);
    expect(useCanvas.getState().frameInsets).toBe(before);
  });
});

domSuite("locateNode", () => {
  test("selects and reveals the node", async () => {
    await useCanvas.getState().locateNode("home", "1.0");
    expect(useCanvas.getState().selection).toEqual({ screenId: "home", path: "1.0" });
    expect(useCanvas.getState().reveal?.path).toBe("1.0");
  });

  test("switches to a loaded board that hosts the screen", async () => {
    useCanvas.setState({
      boards: {
        ...useCanvas.getState().boards,
        docs: {
          id: "docs",
          name: "docs",
          frames: [{ id: frameId("docs"), screen: "guide", x: 0, y: 0, w: 400, h: 300 }],
        },
      } as never,
    });
    await useCanvas.getState().locateNode("guide", "0");
    expect(useCanvas.getState().currentBoardId).toBe("docs");
  });

  test("uses the server's hosting-board hint for a board never loaded", async () => {
    useCanvas.setState({ design: server.design as never });
    await useCanvas.getState().locateNode("guide", "0", { hostBoards: ["docs"] });
    expect(useCanvas.getState().currentBoardId).toBe("docs");
  });

  test("stays put when the current board already shows the screen", async () => {
    useCanvas.setState({ design: server.design as never });
    await useCanvas.getState().locateNode("home", "0", { hostBoards: ["docs"] });
    expect(useCanvas.getState().currentBoardId).toBe("main");
  });

  test("flies to the node's own rect once the frame answers the probe", async () => {
    mountWrapper();
    const flight = useCanvas.getState().locateNode("home", "0");
    // The hosting frame answers the probe with iframe-space geometry.
    await Bun.sleep(20);
    expect(useCanvas.getState().rectProbe?.path).toBe("0");
    useCanvas.getState().setNodeRects(frameId("main"), [{ path: "0", x: 10, y: 20, w: 80, h: 40 }]);
    await flight;
    settleFlight();
    // The node's center, not the frame's, lands on the viewport center.
    const { zoom, pan } = view();
    expect((200 + 10 + 40) * zoom + pan.x).toBeCloseTo(VW / 2, 0);
  });

  test("falls back to framing the whole frame when no geometry arrives", async () => {
    mountWrapper();
    await useCanvas.getState().locateNode("home", "0");
    settleFlight();
    const framed = view();
    useCanvas.setState({ canvasZoom: 0.2, pan: { x: 0, y: 0 } });
    useCanvas.getState().centerOnFrame(frameId("main"));
    expect(framed.zoom).toBeCloseTo(useCanvas.getState().canvasZoom, 6);
    expect(framed.pan.x).toBeCloseTo(useCanvas.getState().pan.x, 0);
  });
});
