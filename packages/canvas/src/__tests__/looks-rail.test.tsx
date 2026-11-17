import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Board, SketchbookDirection, Theme } from "@velloo/schema";
import { LookSchema } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * The Looks rail: every Look listed, the one shown read and edited for its
 * imagery and rules, and its tokens only when it is the board's own, so the
 * frames always show what the controls change.
 */

mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));

const { ThemePanel } = await import("../components/ThemePanel.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

const BOARD_IMAGE = "assets/sketchbook/sb1/poster/board-1.png";

beforeEach(() => {
  localStorage.clear();
  setApiConnected(true);
  server = serveFolder({ boards: { main: ["home"] } });
  server.themes.Poster = { ...(server.themes.default as Theme), name: "Poster" };
  server.looks.Poster = LookSchema.parse({
    description: "Screen-printed park posters",
    images: [{ path: BOARD_IMAGE, kind: "moodboard" }],
    rules: { dos: ["Ink-heavy illustration"] },
    origin: { sketchbook: "sb1", direction: "poster" },
  });
  useCanvas.setState({
    view: "boards",
    design: server.design as never,
    boards: server.boards as Record<string, Board>,
    currentBoardId: "main",
    theme: server.themes.default as Theme,
    themeName: "default",
    looks: null,
    lookFocus: null,
    sketchbooks: [
      {
        id: "sb1",
        name: "Trailhead",
        subject: "page",
        stage: "inspiration",
        agentSession: null,
        buildBoards: {},
        directions: 1,
        images: 1,
      },
    ],
    designMode: "light",
    frameworkRoles: null,
    wsConnected: true,
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

async function rail() {
  localStorage.setItem("velloo:theme-panel:sections", JSON.stringify(["imagery", "rules"]));
  const view = await mount(<ThemePanel theme={server.themes.default as Theme} />);
  views.push(view);
  await settle(10);
  return view;
}

const row = (name: string) => $(`[data-look="${name}"]`) as HTMLElement;
const triggers = () => $$("[data-slot='accordion-trigger']").map(text);

domSuite("the Looks rail", () => {
  test("lists every Look, the board's own marked, each with its cover", async () => {
    await rail();
    expect($$("[data-look]").map((el) => el.getAttribute("data-look"))).toEqual([
      "default",
      "Poster",
    ]);
    expect(text(row("default"))).toContain("This board");
    expect(row("Poster").querySelector("img")?.getAttribute("src")).toBe(`/${BOARD_IMAGE}`);
    expect(text(row("Poster"))).toContain("Screen-printed park posters");
    expect(triggers()).toEqual(["Imagery", "Rules", "Colour", "Type", "Shape"]);
  });

  test("another Look shows its imagery and rules, and its tokens only once the board is on it", async () => {
    await rail();
    await interact(() => row("Poster").click());
    expect(useCanvas.getState().lookFocus).toBe("Poster");
    expect(triggers()).toEqual(["Imagery", "Rules"]);
    expect($(`[data-look-imagery] img`)?.getAttribute("src")).toBe(`/${BOARD_IMAGE}`);
    expect(($("#look-dos-Poster") as HTMLTextAreaElement).value).toBe("Ink-heavy illustration");
    expect(text($("[data-look-origin]"))).toContain("From “Trailhead”, poster");

    const use = $$("button").find((b) => text(b) === "Use on this board") as HTMLElement;
    await interact(() => use.click());
    await settle(10);
    expect(server.mutations).toEqual([
      { op: "update_board", args: { boardId: "main", patch: { theme: "Poster" } } },
    ]);
  });

  test("a rule is saved when the box is left, one per line", async () => {
    await rail();
    await interact(() => row("Poster").click());
    const box = $("#look-donts-Poster") as HTMLTextAreaElement;
    await interact(() => {
      box.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(box, "No drop shadows\n\nNo gradients ");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await interact(() => box.blur());
    await settle(10);
    expect(server.themeWrites).toContainEqual({
      op: "update_look",
      args: { theme: "Poster", rules: { donts: ["No drop shadows", "No gradients"] } },
    });
  });
});

domSuite("making a Look from a sketchbook direction", () => {
  const direction = {
    id: "night",
    title: "Night market",
    description: "Neon",
    layout: "",
    dropped: false,
    picked: true,
    images: [
      {
        kind: "moodboard",
        path: BOARD_IMAGE,
        model: "m",
        prompt: "p",
        createdAt: "2026-11-13T00:00:00Z",
      },
    ],
    proposal: null,
    references: [],
    remixOf: [],
    take: "",
  } satisfies SketchbookDirection;

  test("with no agent on the sketchbook, the Look opens in the rail", async () => {
    useCanvas.setState({ view: "sketchbook", agentSessions: [], agentActiveSessionId: null });
    const { name } = await useCanvas.getState().makeLook("sb1", direction);
    expect(server.themeWrites).toContainEqual({
      op: "update_look",
      args: { fromSketchbook: { sketchbook: "sb1", direction: "night", from: "default" } },
    });
    const state = useCanvas.getState();
    expect([state.view, state.rightTab, state.lookFocus]).toEqual(["boards", "theme", name]);
    expect(state.looks?.some((l) => l.name === name)).toBe(true);
  });

  test("with proposed tokens, the Look takes them and opens on the language stage as a draft", async () => {
    useCanvas.setState({ view: "sketchbook", agentSessions: [], agentActiveSessionId: null });
    const proposed = {
      ...direction,
      proposal: { tokens: { "colors.primary.DEFAULT": "#2f4a3a" }, fonts: [] },
    };
    const { name, draft } = await useCanvas.getState().makeLook("sb1", proposed);
    await settle(10);
    expect(draft).toBe(true);
    let state = useCanvas.getState();
    expect([state.view, state.languageTheme, state.languageThemeIsNew]).toEqual([
      "language",
      name,
      true,
    ]);
    // Cancel discards the draft Look.
    await useCanvas.getState().cancelLanguage();
    state = useCanvas.getState();
    expect(state.view).toBe("boards");
    expect(server.themes[name]).toBeUndefined();
  });
});

domSuite("exploring a Look from the rail", () => {
  test("the Looks rail offers Explore palettes & type", async () => {
    await rail();
    expect(text($("[data-explore-look]") as HTMLElement)).toContain("Explore palettes & type");
  });
});
