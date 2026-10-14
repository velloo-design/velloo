import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Board, Theme } from "@velloo/schema";
import { $, $$, domSuite, interact, layOut, mount, settle, text } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * The design language as a place in the app: what a design with no boards
 * opens to, how the stage is reached and left, and that it is a destination
 * with an address — a link to it, and a back button out of it.
 */

const toasts: string[] = [];
mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  dismissToast: () => {},
  toastError: (_err: unknown, fallback: string) => {
    toasts.push(fallback);
    return "toast";
  },
}));

const { App } = await import("../App.tsx");
const { DesignPane } = await import("../components/Settings/DesignPane.tsx");
const { SettingsMenu } = await import("../components/SettingsMenu.tsx");
const { useUrlState, readUrlState } = await import("../url-state.ts");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

// The specimen fits itself to its pane, and needs one with a size.
layOut("[data-specimen]", () => ({ w: 1120, h: 800 }));

/** The App root opens a socket; live sync has its own suite. */
class InertSocket {
  close(): void {}
}
const realWebSocket = globalThis.WebSocket;

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

function at(search: string): void {
  window.history.replaceState({}, "", `/${search}`);
}

function serve(spec: Parameters<typeof serveFolder>[0]): void {
  server = serveFolder(spec);
  useCanvas.setState({
    design: null,
    bootError: null,
    folderConfig: null,
    view: "boards",
    libraryItem: null,
    editingSnippetId: null,
    boards: {},
    screens: {},
    currentBoardId: null,
    currentScreenId: null,
    theme: null,
    themeName: "default",
    selection: null,
    languageRules: null,
    languageBaseline: null,
    languageHandoff: null,
    languageTheme: "default",
    languageThemeIsNew: false,
    wsConnected: true,
    settingsScope: null,
  });
}

async function boot(search = ""): Promise<void> {
  at(search);
  views.push(await mount(<App />));
  await settle(30);
}

const button = (name: string) =>
  $$("button").find((el) => text(el).startsWith(name)) as HTMLButtonElement | undefined;
const state = () => useCanvas.getState();

beforeEach(() => {
  toasts.length = 0;
  localStorage.clear();
  setApiConnected(true);
  globalThis.WebSocket = InertSocket as unknown as typeof WebSocket;
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  globalThis.WebSocket = realWebSocket;
  server.restore();
  at("");
});

domSuite("a design with no boards yet", () => {
  test("opens to the design language, not to an empty canvas", async () => {
    serve({ boards: {} });
    await boot();
    expect(text($("h1"))).toBe("Start with a design language");
    expect($("[data-language-stage]")).toBeNull();
  });

  test("defining it there walks through the stage, beside the specimen", async () => {
    serve({ boards: {} });
    await boot();
    await interact(() => button("Start")?.click());
    await settle(30);
    expect($("[data-language-stage]")?.getAttribute("data-language-stage")).toBe("guided");
    expect($("[data-specimen]")).not.toBeNull();
  });

  test("the plain way out is one empty board, opened", async () => {
    serve({ boards: {} });
    server.replies.add_board = { boardId: "first" };
    server.boards.first = { id: "first", name: "Main", frames: [], groups: [] } as unknown as Board;
    await boot();
    await interact(() => button("Or start with an empty board")?.click());
    await settle(30);
    expect(server.mutations).toEqual([{ op: "add_board", args: { name: "Main" } }]);
    expect(state().currentBoardId).toBe("first");
    expect(text(document.body)).toContain('Board "Main" is empty');
  });

  test("a board that could not be made is reported, and the offer stands", async () => {
    serve({ boards: {} });
    server.fail("/api/mutate/add_board");
    await boot();
    await interact(() => button("Or start with an empty board")?.click());
    await settle(30);
    expect(toasts).toEqual(["Could not create board"]);
    expect(text($("h1"))).toBe("Start with a design language");
  });

  test("a design that has boards opens to its board", async () => {
    serve({ boards: { main: ["home"] } });
    await boot();
    expect($("h1")).toBeNull();
    expect($("[data-frame-id]")).not.toBeNull();
  });
});

domSuite("a link to the design language", () => {
  test("opens the stage for review, on the theme of the board it would have shown", async () => {
    serve({ boards: { night: ["console"] }, boardThemes: { night: "Night" } });
    // Every specimen the page asks for on the way in, not only the last.
    const requested: string[] = [];
    const watch = new window.MutationObserver((records) => {
      for (const record of records) {
        const nodes = record.type === "attributes" ? [record.target] : [...record.addedNodes];
        for (const node of nodes) {
          if (!(node instanceof window.HTMLElement)) continue;
          for (const frame of [node, ...node.querySelectorAll("iframe")]) {
            const src = frame.tagName === "IFRAME" ? frame.getAttribute("src") : null;
            if (src?.includes("/api/render/specimen")) requested.push(src);
          }
        }
      }
    });
    watch.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src"],
    });
    await boot("?view=language");
    watch.disconnect();
    expect($("[data-language-stage]")?.getAttribute("data-language-stage")).toBe("review");
    expect(state().languageTheme).toBe("Night");
    expect(state().languageBaseline?.theme.name).toBe("Night");
    // Nothing was drawn of the default theme while the board's was being found.
    const themes = requested.map((src) => new URL(src, "http://x").searchParams.get("theme"));
    expect(themes.length).toBeGreaterThan(0);
    expect(new Set(themes)).toEqual(new Set(["Night"]));
  });

  test("the stage takes the canvas: no board, no sidebar tree, no inspector beside it", async () => {
    serve({ boards: { main: ["home"] } });
    await boot("?view=language");
    expect($("[data-frame-id]")).toBeNull();
    expect($$("aside")).toHaveLength(1);
    expect($("aside")?.hasAttribute("data-language-stage")).toBe(true);
  });

  test("a stage that cannot open says so", async () => {
    serve({ boards: { main: ["home"] } });
    server.fail("/api/design-language");
    await boot("?view=language");
    expect(toasts).toContain("Could not open the design language");
  });

  test("keeping a change there raises the hand-off over the board it returns to", async () => {
    serve({ boards: { main: ["home"] } });
    await boot("?view=language");
    await interact(() =>
      useCanvas.setState((s) => ({ theme: { ...(s.theme as Theme), radius: { md: "0rem" } } })),
    );
    await interact(() => button("Done")?.click());
    await settle(30);
    expect(state().view).toBe("boards");
    expect($("[data-frame-id]")).not.toBeNull();
    expect(text($("[data-testid='language-handoff']"))).toContain("Bring your boards in line");
    expect(text($("[data-testid='language-handoff'] pre"))).toContain("(corners)");
  });
});

domSuite("from settings into the stage", () => {
  test("the settings dialog gets out of the way: the stage takes the whole canvas", async () => {
    serve({ boards: { main: ["home"] } });
    await state().loadFolderConfig();
    const cfg = state().folderConfig;
    if (!cfg) throw new Error("folder config did not load");
    useCanvas.setState({ design: server.design as never, settingsScope: "design" });
    views.push(await mount(<DesignPane cfg={cfg} />));
    await interact(() => button("Open")?.click());
    await settle(30);
    expect(state().settingsScope).toBeNull();
    expect([state().view, state().languageMode]).toEqual(["language", "review"]);
  });
});

domSuite("from the account menu into the stage", () => {
  test("Design language sits beside Settings and opens the stage for review", async () => {
    serve({ boards: { main: ["home"] } });
    useCanvas.setState({ design: server.design as never });
    const view = await mount(<SettingsMenu />);
    views.push(view);
    await settle();
    // Radix opens a dropdown on pointerdown, not click.
    await interact(() => {
      const trigger = view.host.querySelector("button") as HTMLElement;
      trigger.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
      trigger.click();
    });
    await settle();
    const item = $$('[role="menuitem"]').find((el) => text(el) === "Design language");
    await interact(() => item?.click());
    await settle(30);
    expect([state().view, state().languageMode]).toEqual(["language", "review"]);
  });
});

domSuite("the stage in the address bar", () => {
  /** A component that does nothing but keep the URL in sync with the store. */
  function UrlSync() {
    useUrlState();
    return null;
  }

  async function sync(search: string, seed: Partial<ReturnType<typeof state>> = {}) {
    serve({ boards: { main: ["home"] } });
    at(search);
    useCanvas.setState({
      boards: server.boards as Record<string, Board>,
      currentBoardId: "main",
      currentScreenId: "home",
      ...seed,
    });
    views.push(await mount(<UrlSync />));
  }

  /** The browser's back or forward button landing on `search`. */
  async function travelTo(search: string): Promise<void> {
    at(search);
    await interact(() => {
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    });
    await settle(30);
  }

  test("a link to it is read as the stage", () => {
    at("?view=language");
    expect(readUrlState().view).toBe("language");
  });

  test("entering it is a navigation, addressed without the board behind it", async () => {
    await sync("?board=main&screen=home");
    const before = window.history.length;
    await interact(() => state().openLanguage());
    await settle(30);
    expect(window.location.search).toBe("?view=language");
    expect(window.history.length).toBe(before + 1);
  });

  test("forward into it opens the stage and takes its baseline", async () => {
    await sync("?board=main&screen=home");
    await travelTo("?view=language");
    expect(state().view).toBe("language");
    expect(state().languageBaseline?.theme.name).toBe("default");
  });

  test("back out of it is Cancel: the theme goes back to how the stage found it", async () => {
    await sync("?board=main&screen=home");
    await interact(() => state().openLanguage());
    await settle(30);
    const onEntry = state().languageBaseline?.theme;
    await interact(() =>
      useCanvas.setState((s) => ({ theme: { ...(s.theme as Theme), radius: { md: "0rem" } } })),
    );
    await travelTo("?board=main&screen=home");
    expect(state().view).toBe("boards");
    expect(server.restores).toHaveLength(1);
    expect(server.restores[0]).toMatchObject({ name: "default", theme: onEntry });
    expect(state().languageBaseline).toBeNull();
  });

  test("back out of a theme made for the visit removes it, and leaves the board off it", async () => {
    await sync("?board=main&screen=home");
    await interact(() => state().startTheme("Dusk"));
    await settle(30);
    await travelTo("?board=main&screen=home");
    expect(state().view).toBe("boards");
    expect(server.themeWrites.map((w) => w.op)).toEqual(["add_theme", "remove_theme"]);
    expect(Object.keys(server.themes)).not.toContain("Dusk");
    expect(server.mutations).toEqual([]);
    expect([state().languageThemeIsNew, state().themeName]).toEqual([false, "default"]);
  });

  test("back after Done takes nothing back: the stage was already left", async () => {
    await sync("?board=main&screen=home");
    await interact(() => state().startTheme("Dusk"));
    await settle(30);
    await interact(() => state().finishLanguage());
    await settle(30);
    // Done was a navigation of its own, so Back lands on the stage again.
    await travelTo("?view=language");
    expect(server.mutations).toEqual([
      { op: "update_board", args: { boardId: "main", patch: { theme: "Dusk" } } },
    ]);
    expect(server.themeWrites.map((w) => w.op)).toEqual(["add_theme"]);
    expect(server.restores).toEqual([]);
  });

  test("back while Done is still pinning the board does not undo it", async () => {
    await sync("?board=main&screen=home");
    await interact(() => state().startTheme("Dusk"));
    await settle(30);
    server.slow("/api/mutate/update_board", 60);
    await interact(() => {
      void state().finishLanguage();
    });
    await travelTo("?board=main&screen=home");
    await settle(100);
    expect(state().view).toBe("boards");
    expect(server.mutations).toHaveLength(1);
    expect(server.themeWrites.map((w) => w.op)).toEqual(["add_theme"]);
    expect(server.restores).toEqual([]);
  });

  test("back before the stage has finished opening leaves it for good", async () => {
    await sync("?board=main&screen=home");
    server.slow("/api/design-language", 60);
    await interact(() => {
      void state().startTheme("Dusk");
    });
    await settle(10);
    expect([state().view, state().languageBaseline]).toEqual(["language", null]);
    await travelTo("?board=main&screen=home");
    await settle(100);
    // Nothing had been edited yet, so nothing is put back; the draft still goes.
    expect(server.restores).toEqual([]);
    expect(server.themeWrites.map((w) => w.op)).toEqual(["add_theme", "remove_theme"]);
    // The open that was still loading does not bring the stage back when it lands.
    expect([state().view, state().languageBaseline, state().themeName]).toEqual([
      "boards",
      null,
      "default",
    ]);
    expect(toasts).toEqual([]);
  });

  test("forward into a stage that cannot open says so, and throws nothing", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      await sync("?board=main&screen=home");
      server.fail("/api/design-language");
      await travelTo("?view=language");
      await settle(10);
      expect(toasts).toEqual(["Could not open the design language"]);
      expect(state().view).toBe("boards");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});
