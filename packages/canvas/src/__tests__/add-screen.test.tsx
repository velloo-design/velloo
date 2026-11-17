import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { AgentContextCard } from "@velloo/protocol/agent";
import type { Board, SketchbookPage, Theme } from "@velloo/schema";
import { LookSchema } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * A board's first screen starts three ways: blank, from one of the design's
 * Looks (the board is put on it and an agent is asked), or ported from a page
 * of the app — offered only when there is an app.
 */

mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));

const { EmptyBoard } = await import("../components/AddScreen/EmptyBoard.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];
let asked: { text: string; card: AgentContextCard }[];
let explored: SketchbookPage[];

const IMAGE = "assets/sketchbook/sb1/poster/board-1.png";

beforeEach(() => {
  localStorage.clear();
  setApiConnected(true);
  server = serveFolder({ boards: { main: [] }, screens: ["home"] });
  server.themes.Poster = { ...(server.themes.default as Theme), name: "Poster" };
  server.looks.Poster = LookSchema.parse({
    description: "Screen-printed park posters",
    images: [{ path: IMAGE, kind: "moodboard" }],
  });
  asked = [];
  explored = [];
  useCanvas.setState({
    view: "boards",
    design: server.design as never,
    boards: server.boards as Record<string, Board>,
    currentBoardId: "main",
    themeName: "default",
    looks: null,
    lookFocus: null,
    wsConnected: true,
    askAgentAbout: async (text: string, card: AgentContextCard) => {
      asked.push({ text, card });
    },
    exploreLooksFor: async (page: SketchbookPage) => {
      explored.push(page);
    },
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

async function emptyBoard() {
  const view = await mount(<EmptyBoard board={{ id: "main", name: "Main" }} />);
  views.push(view);
  await settle(10);
}

const button = (label: string) =>
  $$("button").find((b) => text(b).trim() === label) as HTMLElement | undefined;

domSuite("starting a board's first screen", () => {
  test("with no app, the empty board offers blank and a look, not porting", async () => {
    await emptyBoard();
    expect($$("[data-empty-board-starts] button").map((b) => text(b).trim())).toEqual([
      "Blank",
      "From a look",
    ]);
  });

  test("with an app, porting a page asks the agent with the page on a card", async () => {
    server.sketchbookPages = {
      hasApp: true,
      pages: [
        {
          kind: "route",
          page: { label: "/pricing", route: "/pricing", file: "app/pricing/page.tsx" },
          detail: "app/pricing/page.tsx",
        },
        { kind: "screen", page: { label: "home", screenId: "home" } },
      ],
    };
    await emptyBoard();
    expect(button("Port from app")).toBeDefined();
    await interact(() => button("Port from app")?.click());
    await settle(10);
    expect($("[data-add-screen]")).not.toBeNull();
    // Only the app's pages are offered, not the canvas's screens.
    const select = $("#sketchbook-page") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).not.toContain("home");
    await interact(() => {
      select.value = "0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await interact(() => button("Port it")?.click());
    await settle(10);
    expect(asked).toEqual([
      {
        text: "Port /pricing from the app onto this board.",
        card: {
          kind: "port",
          ref: { boardId: "main", route: "/pricing", file: "app/pricing/page.tsx" },
          label: "Port · /pricing",
        },
      },
    ]);
  });

  test("a look puts the board on it and asks the agent to design in it", async () => {
    await emptyBoard();
    await interact(() => button("From a look")?.click());
    await settle(10);
    const looks = $$("[data-start-look]").map((el) => el.getAttribute("data-start-look"));
    // The Look with imagery comes first.
    expect(looks).toEqual(["Poster", "default"]);
    expect($('[data-start-look="Poster"] img')?.getAttribute("src")).toBe(`/${IMAGE}`);
    const what = $("#add-screen-what") as HTMLInputElement;
    await interact(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(what, "A pricing page");
      what.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await interact(() => ($('[data-start-look="Poster"]') as HTMLElement).click());
    await interact(() => button("Design it")?.click());
    await settle(10);
    expect(server.mutations).toEqual([
      { op: "update_board", args: { boardId: "main", patch: { theme: "Poster" } } },
    ]);
    expect(asked).toEqual([
      {
        text: "Design this screen in the “Poster” look: A pricing page",
        card: {
          kind: "look",
          ref: { boardId: "main", theme: "Poster" },
          label: "Design in Poster",
        },
      },
    ]);
  });

  test("explore new looks starts a sketchbook for the screen", async () => {
    await emptyBoard();
    await interact(() => button("From a look")?.click());
    await settle(10);
    await interact(() => ($("[data-explore-new-looks]") as HTMLElement).click());
    await settle(10);
    expect(explored).toEqual([{ label: "main" }]);
    expect(server.mutations).toEqual([]);
  });
});
