import { afterAll, beforeEach, expect, test } from "bun:test";
import type { DesignSummary } from "../api.ts";
import { $, domSuite, interact, mount, press, settle, text } from "./dom.ts";

/**
 * The first-run tour. Two things matter beyond the card itself: that it is
 * shown once per *person* — the daemon's prefs file, not the browser, since
 * every daemon is its own origin — and that it points only at what is on
 * screen, so a narrow window gets a shorter tour rather than a card pointing
 * at nothing.
 */

let prefs: { tourSeen: boolean } | "down";
const saved: unknown[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname !== "/api/prefs") throw new Error(`unexpected fetch: ${url.pathname}`);
  if (prefs === "down") return new Response("unavailable", { status: 503 });
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as { tourSeen?: boolean };
    saved.push(body);
    prefs = { ...prefs, ...body };
  }
  return Response.json(prefs);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { Tour, useFirstRunTour } = await import("../components/Tour.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");
const { readTourSeen, markTourSeen, tourAutoStart } = await import("../tour.ts");

/**
 * happy-dom lays nothing out, so the canvas's landmarks are stand-ins that
 * report where they would be in a 1024×768 window: the board between the two
 * panes, the Agent tab at the top of the right one, the comment tool in the bar.
 */
const LAYOUT: Record<string, { left: number; top: number; width: number; height: number }> = {
  board: { left: 260, top: 44, width: 444, height: 724 },
  left: { left: 0, top: 44, width: 260, height: 724 },
  right: { left: 704, top: 44, width: 320, height: 724 },
  agent: { left: 712, top: 52, width: 90, height: 28 },
  comment: { left: 600, top: 8, width: 28, height: 28 },
};

function rectOf(el: Element): DOMRect {
  const key = el.getAttribute("data-layout");
  const box = key ? LAYOUT[key] : undefined;
  if (!box) return new window.DOMRect(0, 0, 0, 0) as unknown as DOMRect;
  return new window.DOMRect(box.left, box.top, box.width, box.height) as unknown as DOMRect;
}
const realRect = window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  return this.hasAttribute("data-layout") ? rectOf(this) : realRect.call(this);
};
// happy-dom reports itself as automated, which is exactly what keeps the tour
// from opening by itself; these tests are the person, not a harness.
Object.defineProperty(window.navigator, "webdriver", { configurable: true, get: () => false });

function Canvas({ comment = true }: { comment?: boolean }) {
  return (
    <div>
      <aside data-pane="left" data-layout="left" />
      <main data-tour="board" data-layout="board" />
      <aside data-pane="right" data-layout="right">
        <button type="button" data-tour="agent" data-layout="agent">
          Agent
        </button>
      </aside>
      {comment ? (
        <button type="button" data-tour="comment-tool" data-layout="comment">
          C
        </button>
      ) : null}
      <Tour />
    </div>
  );
}

const card = () => $("[data-testid='tour-card']");
const title = () => text(card()?.querySelector("[data-slot='popover-title']") ?? null);
const click = (id: string) => interact(() => ($(`[data-testid='${id}']`) as HTMLElement).click());

beforeEach(() => {
  prefs = { tourSeen: false };
  saved.length = 0;
  localStorage.clear();
  setApiConnected(true);
  useCanvas.setState({ tourOpen: false, view: "boards", design: null });
  window.history.replaceState({}, "", "/");
});

domSuite("the canvas tour", () => {
  test("walks the steps with Next and Back, and Done closes it", async () => {
    const view = await mount(<Canvas />);
    await interact(() => useCanvas.getState().startTour());
    await settle();

    expect(title()).toBe("Your board");
    expect(text(card())).toContain("1 of 5");
    // The card names itself by its title and reads its body as the description.
    const labelled = card()?.getAttribute("aria-labelledby") ?? "";
    expect(text(document.getElementById(labelled))).toBe("Your board");
    expect(card()?.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe($("[data-testid='tour-next']"));
    expect($("[data-testid='tour-back']")).toBeNull();

    await click("tour-next");
    expect(title()).toBe("Boards and library");
    await click("tour-back");
    expect(title()).toBe("Your board");

    for (const expected of ["Boards and library", "Change what you select", "Your agent"]) {
      await click("tour-next");
      expect(title()).toBe(expected);
      // The step about editing what you select shows the tab it talks about.
      if (expected === "Change what you select") expect(useCanvas.getState().rightTab).toBe("node");
    }
    await click("tour-next");
    expect(title()).toBe("Comments");
    expect(text(card())).toContain("5 of 5");
    expect($("[data-testid='tour-skip']")).toBeNull();
    expect(text($("[data-testid='tour-next']"))).toBe("Done");

    await click("tour-next");
    expect(useCanvas.getState().tourOpen).toBe(false);
    expect(card()).toBeNull();
    await view.unmount();
  });

  test("lights up the step's target", async () => {
    const view = await mount(<Canvas />);
    await interact(() => useCanvas.getState().startTour());
    await settle();
    await click("tour-next");
    const spot = $("[data-testid='tour-spotlight']") as HTMLElement;
    // The left pane, padded and kept inside the window so its ring shows.
    expect(spot.style.left).toBe("2px");
    expect(spot.style.top).toBe("40px");
    expect(spot.style.width).toBe("262px");
    await view.unmount();
  });

  test("Escape skips the tour, and so does Skip", async () => {
    const view = await mount(<Canvas />);
    await interact(() => useCanvas.getState().startTour());
    await settle();
    await interact(() => press(document.activeElement as Element, "Escape"));
    expect(useCanvas.getState().tourOpen).toBe(false);

    await interact(() => useCanvas.getState().startTour());
    await settle();
    await click("tour-skip");
    expect(useCanvas.getState().tourOpen).toBe(false);
    await view.unmount();
  });

  test("arrow keys step through, and the canvas's own shortcuts don't hear them", async () => {
    const heard: string[] = [];
    const listen = (e: KeyboardEvent) => heard.push(e.key);
    window.addEventListener("keydown", listen);
    const view = await mount(<Canvas />);
    await interact(() => useCanvas.getState().startTour());
    await settle();
    await interact(() => press(document.activeElement as Element, "ArrowRight"));
    expect(title()).toBe("Boards and library");
    await interact(() => press(document.activeElement as Element, "c"));
    await interact(() => press(document.activeElement as Element, "ArrowLeft"));
    expect(title()).toBe("Your board");
    expect(heard).toEqual([]);
    window.removeEventListener("keydown", listen);
    await view.unmount();
  });

  test("leaves out a step whose target isn't on screen", async () => {
    const view = await mount(<Canvas comment={false} />);
    await interact(() => useCanvas.getState().startTour());
    await settle();
    expect(text(card())).toContain("1 of 4");
    await view.unmount();
  });

  test("opens by itself the first time, and says so to the daemon", async () => {
    function FirstRun() {
      useFirstRunTour();
      return <Canvas />;
    }
    const view = await mount(<FirstRun />);
    await interact(() => useCanvas.setState({ design: {} as DesignSummary }));
    await settle(10);
    expect(useCanvas.getState().tourOpen).toBe(true);
    expect(saved).toEqual([{ tourSeen: true }]);
    await view.unmount();
  });

  test("doesn't open by itself once seen, or under ?tour=0", async () => {
    function FirstRun() {
      useFirstRunTour();
      return <Canvas />;
    }
    prefs = { tourSeen: true };
    let view = await mount(<FirstRun />);
    await interact(() => useCanvas.setState({ design: {} as DesignSummary }));
    await settle(10);
    expect(useCanvas.getState().tourOpen).toBe(false);
    await view.unmount();

    prefs = { tourSeen: false };
    useCanvas.setState({ design: null });
    window.history.replaceState({}, "", "/?tour=0");
    view = await mount(<FirstRun />);
    await interact(() => useCanvas.setState({ design: {} as DesignSummary }));
    await settle(10);
    expect(useCanvas.getState().tourOpen).toBe(false);
    await view.unmount();
  });
});

domSuite("whether the tour was seen", () => {
  test("is the daemon's answer, shared by every canvas on this machine", async () => {
    expect(await readTourSeen()).toBe(false);
    await markTourSeen();
    expect(saved).toEqual([{ tourSeen: true }]);
    localStorage.clear();
    expect(await readTourSeen()).toBe(true);
  });

  test("falls back to this browser when the daemon can't answer", async () => {
    prefs = "down";
    expect(await readTourSeen()).toBe(false);
    await markTourSeen();
    expect(await readTourSeen()).toBe(true);
  });

  test("automation doesn't get it unless it asks", () => {
    expect(tourAutoStart("", false)).toBe("first-run");
    expect(tourAutoStart("", true)).toBe("never");
    expect(tourAutoStart("?board=main&tour=0", false)).toBe("never");
    expect(tourAutoStart("?tour=1", true)).toBe("always");
  });
});
