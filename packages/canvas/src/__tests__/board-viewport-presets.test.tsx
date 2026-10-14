import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Board as BoardT, Screen, ViewportPreset } from "@velloo/schema";
import { $$, domSuite, interact, mount } from "./dom.ts";
import { type FakeServer, screenFixture, serveFolder } from "./fake-server.ts";

/**
 * A folder's viewport presets are edited in Settings → Design and by an
 * agent's `update_viewport_presets`. The add-frame and preview dialogs always
 * read them; the board's frames used a hard-coded three instead, so a folder
 * with its own presets saw them everywhere except under its frames.
 */

const { useCanvas } = await import("../store.ts");
const { Board } = await import("../components/Board.tsx");
const { useViewportPresets } = await import("../viewport-presets.ts");

const WATCH: ViewportPreset = { name: "Watch", w: 198, h: 242 };
const KIOSK: ViewportPreset = { name: "Kiosk", w: 1080, h: 1920 };

let server: FakeServer;
const board = (): BoardT => server.boards.main as BoardT;

function withPresets(viewportPresets: ViewportPreset[]): void {
  useCanvas.setState({ design: { ...server.design, viewportPresets } as never });
}

/** The footer chips under each frame, by their `name: w×h` title. */
const chips = (): string[] => $$("button[title*='×']").map((b) => b.getAttribute("title") ?? "");

beforeEach(() => {
  server = serveFolder({ boards: { main: ["home"] } });
  useCanvas.setState({
    boards: { main: board() },
    screens: { home: screenFixture("home") as Screen },
    currentBoardId: "main",
    currentScreenId: "home",
    canvasZoom: 1,
    pan: { x: 0, y: 0 },
  });
});

afterEach(() => server.restore());

domSuite("a frame offers the folder's viewport presets", () => {
  test("the folder's own presets, not the stock three", async () => {
    withPresets([WATCH, KIOSK]);
    const view = await mount(<Board board={board()} />);
    expect(chips()).toEqual(["Watch: 198×242", "Kiosk: 1080×1920"]);
    await view.unmount();
  });

  test("an edit to the presets reaches a board already on screen", async () => {
    withPresets([WATCH]);
    const view = await mount(<Board board={board()} />);
    await interact(() => withPresets([WATCH, KIOSK]));
    expect(chips()).toEqual(["Watch: 198×242", "Kiosk: 1080×1920"]);
    await view.unmount();
  });

  test("the stock three before the folder has any", async () => {
    withPresets([]);
    const view = await mount(<Board board={board()} />);
    expect(chips()).toEqual(["Mobile: 390×844", "Tablet: 768×1024", "Desktop: 1440×900"]);
    await view.unmount();
  });

  test("a refreshed summary with the same presets keeps the same array", async () => {
    const seen: ViewportPreset[][] = [];
    function Probe() {
      // Re-render on every summary, the way a frame's other props would.
      useCanvas((s) => s.design);
      seen.push(useViewportPresets());
      return null;
    }
    withPresets([WATCH]);
    const view = await mount(<Probe />);
    // A refetch parses fresh objects, equal in content.
    await interact(() => withPresets([{ ...WATCH }]));
    await interact(() => withPresets([WATCH, KIOSK]));
    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0] as ViewportPreset[]);
    expect(seen[2]).toEqual([WATCH, KIOSK]);
    await view.unmount();
  });
});
