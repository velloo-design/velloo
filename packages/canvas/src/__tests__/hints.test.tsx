import { afterAll, beforeEach, expect, test } from "bun:test";
import type { DesignSummary } from "../api.ts";
import { $, $$, domSuite, interact, mount, press, settle, text } from "./dom.ts";

/**
 * The first-run hints. Two things matter beyond the dots themselves: that
 * only a couple are out at once, the next arriving as one is dismissed, and
 * that a dismissal is kept per *person* — the daemon's prefs file, not the
 * browser, since every daemon is its own origin.
 */

let prefs: { hintsSeen: string[] } | "down";
const saved: unknown[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname !== "/api/prefs") throw new Error(`unexpected fetch: ${url.pathname}`);
  if (prefs === "down") return new Response("unavailable", { status: 503 });
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as { dismissHints?: string[]; resetHints?: true };
    saved.push(body);
    const seen = body.resetHints ? [] : prefs.hintsSeen;
    prefs = { hintsSeen: [...new Set([...seen, ...(body.dismissHints ?? [])])] };
  }
  return Response.json(prefs);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { Hints, useHints } = await import("../components/Hints.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");
const { readHintsSeen, dismissHints, hintsMode } = await import("../hints.ts");

/**
 * happy-dom lays nothing out, so the canvas's landmarks are stand-ins that
 * report where they would be in a 1024×768 window.
 */
const LAYOUT: Record<string, { left: number; top: number; width: number; height: number }> = {
  board: { left: 260, top: 44, width: 444, height: 724 },
  agent: { left: 712, top: 52, width: 90, height: 28 },
  design: { left: 806, top: 52, width: 90, height: 28 },
  comment: { left: 600, top: 8, width: 28, height: 28 },
  library: { left: 130, top: 52, width: 120, height: 28 },
};

const realRect = window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const box = LAYOUT[this.getAttribute("data-layout") ?? ""];
  if (!box) return realRect.call(this);
  return new window.DOMRect(box.left, box.top, box.width, box.height) as unknown as DOMRect;
};
// happy-dom reports itself as automated, which is exactly what keeps hints
// away; these tests are the person, not a harness.
Object.defineProperty(window.navigator, "webdriver", { configurable: true, get: () => false });

function Canvas({ comment = true }: { comment?: boolean }) {
  useHints();
  return (
    <div>
      <button type="button" data-hint="library" data-layout="library">
        Library
      </button>
      <main data-hint="board" data-layout="board" />
      <button type="button" data-hint="agent" data-layout="agent">
        Agent
      </button>
      <button type="button" data-hint="design" data-layout="design">
        Design
      </button>
      {comment ? (
        <button type="button" data-hint="comment-tool" data-layout="comment">
          C
        </button>
      ) : null}
      <Hints />
    </div>
  );
}

const dots = () => $$("button[aria-label^='Tip: ']");
const shown = () => dots().map((el) => el.getAttribute("data-testid")?.replace("hint-", ""));
const click = (el: Element | null) => interact(() => (el as HTMLElement).click());

async function open() {
  const view = await mount(<Canvas />);
  await interact(() => useCanvas.setState({ design: {} as DesignSummary }));
  await settle(10);
  return view;
}

beforeEach(() => {
  prefs = { hintsSeen: [] };
  saved.length = 0;
  localStorage.clear();
  setApiConnected(true);
  useCanvas.setState({ hintsSeen: null, view: "boards", design: null });
  window.history.replaceState({}, "", "/");
});

domSuite("the canvas hints", () => {
  test("two are out at first, and dismissing one brings the next", async () => {
    const view = await open();
    expect(shown()).toEqual(["agent", "board"]);

    await click($("[data-testid='hint-agent']"));
    const card = $("[data-testid='hint-card']");
    expect(text(card)).toContain("Your agent, in the canvas");
    await click($("[data-testid='hint-got-it']"));
    await settle(10);

    expect(shown()).toEqual(["board", "design"]);
    expect(saved).toEqual([{ dismissHints: ["agent"] }]);
    await view.unmount();
  });

  test("a dot sits on its target's corner, or inside a large one", async () => {
    const view = await open();
    const agent = $("[data-testid='hint-agent']") as HTMLElement;
    expect([agent.style.left, agent.style.top]).toEqual(["798px", "56px"]);
    const board = $("[data-testid='hint-board']") as HTMLElement;
    expect([board.style.left, board.style.top]).toEqual(["288px", "72px"]);
    await view.unmount();
  });

  test("Hide all tips dismisses every hint", async () => {
    const view = await open();
    await click($("[data-testid='hint-board']"));
    await click($("[data-testid='hint-hide-all']"));
    await settle(10);
    expect(shown()).toEqual([]);
    expect(prefs !== "down" && prefs.hintsSeen.length).toBe(5);
    await view.unmount();
  });

  test("the canvas's own shortcuts don't hear keys pressed in a card", async () => {
    const heard: string[] = [];
    const listen = (e: KeyboardEvent) => heard.push(e.key);
    window.addEventListener("keydown", listen);
    const view = await open();
    await click($("[data-testid='hint-agent']"));
    await interact(() => press($("[data-testid='hint-got-it']") as Element, "c"));
    expect(heard).toEqual([]);
    window.removeEventListener("keydown", listen);
    await view.unmount();
  });

  test("a hint whose target isn't on screen waits, and the next one shows", async () => {
    prefs = { hintsSeen: ["agent", "board", "design"] };
    const view = await mount(<Canvas comment={false} />);
    await interact(() => useCanvas.setState({ design: {} as DesignSummary }));
    await settle(10);
    expect(shown()).toEqual(["library"]);
    await view.unmount();
  });

  test("none show off the boards view, or under ?hints=0", async () => {
    let view = await open();
    await interact(() => useCanvas.setState({ view: "language" }));
    expect(shown()).toEqual([]);
    await view.unmount();

    useCanvas.setState({ hintsSeen: null, view: "boards", design: null });
    window.history.replaceState({}, "", "/?hints=0");
    view = await open();
    expect(shown()).toEqual([]);
    await view.unmount();
  });
});

domSuite("which hints were dismissed", () => {
  test("is the daemon's answer, shared by every canvas on this machine", async () => {
    expect(await readHintsSeen()).toEqual([]);
    await dismissHints(["agent"]);
    expect(saved).toEqual([{ dismissHints: ["agent"] }]);
    localStorage.clear();
    expect(await readHintsSeen()).toEqual(["agent"]);
  });

  test("falls back to this browser when the daemon can't answer", async () => {
    prefs = "down";
    expect(await readHintsSeen()).toEqual([]);
    await dismissHints(["board"]);
    expect(await readHintsSeen()).toEqual(["board"]);
  });

  test("automation gets none unless it asks", () => {
    expect(hintsMode("", false)).toBe("unseen");
    expect(hintsMode("", true)).toBe("never");
    expect(hintsMode("?board=main&hints=0", false)).toBe("never");
    expect(hintsMode("?hints=1", true)).toBe("all");
  });
});
