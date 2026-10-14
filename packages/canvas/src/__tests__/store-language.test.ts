import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Board, Theme } from "@velloo/schema";
import { setApiConnected } from "../api/connection.ts";
import { useCanvas } from "../store.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * The design-language stage's contract with the daemon. Its edits are live —
 * ordinary theme and rule writes — so everything that makes the stage safe to
 * walk into lives here rather than in a component: which theme it is on, what
 * it remembers of that theme on the way in, what Cancel sends back, and that a
 * theme made for the visit is not left behind.
 */

let server: FakeServer;

const state = () => useCanvas.getState();
const lastRestore = () => server.restores.at(-1) as Record<string, unknown>;
const themeOps = () => server.themeWrites.map((w) => w.op);

/** An edit made in the stage, as it arrives: the theme in the store has changed. */
function edit(patch: Partial<Theme>): void {
  useCanvas.setState({ theme: { ...(state().theme as Theme), ...patch } });
}

/** Boot far enough that there is a board behind the stage. */
async function onBoard(boardId: string | null): Promise<void> {
  useCanvas.setState({
    boards: server.boards as Record<string, Board>,
    currentBoardId: boardId,
  });
  await state().loadTheme();
}

beforeEach(() => {
  setApiConnected(true);
  server = serveFolder({
    boards: { main: ["home"], docs: ["guide"], night: ["console"] },
    boardThemes: { night: "Night" },
  });
  useCanvas.setState({
    view: "boards",
    design: null,
    folderConfig: null,
    boards: {},
    currentBoardId: null,
    theme: null,
    themeName: "default",
    designMode: "light",
    selection: null,
    languageRules: null,
    languageBaseline: null,
    languageHandoff: null,
    languageTheme: "default",
    languageThemeIsNew: false,
    frameworkRoles: null,
  });
});

afterEach(() => {
  server.restore();
});

describe("a stage that cannot open", () => {
  test("goes back to the board and says why, instead of waiting with no way out", async () => {
    await onBoard("main");
    server.fail("/api/design-language");
    await expect(state().openLanguage()).rejects.toThrow();
    expect(state().view).toBe("boards");
    expect(state().languageBaseline).toBeNull();
  });
});

describe("which theme the stage is on", () => {
  test("the one the board behind it renders with", async () => {
    await onBoard("night");
    await state().openLanguage();
    expect(state().view).toBe("language");
    expect(state().languageTheme).toBe("Night");
    expect(state().themeName).toBe("Night");
    expect(state().theme?.name).toBe("Night");
  });

  test("the default, for a board that pins none and for no board at all", async () => {
    await onBoard("main");
    await state().openLanguage();
    expect(state().languageTheme).toBe("default");

    await state().finishLanguage();
    await onBoard(null);
    await state().openLanguage();
    expect(state().languageTheme).toBe("default");
  });

  test("another theme when it is opened for one", async () => {
    await onBoard("main");
    await state().openLanguage("review", "Night");
    expect(state().languageTheme).toBe("Night");
    expect(state().theme?.name).toBe("Night");
  });

  test("it opens in the palette the canvas is showing", async () => {
    useCanvas.setState({ designMode: "dark" });
    await onBoard("main");
    await state().openLanguage();
    expect(state().languageScheme).toBe("dark");
  });

  test("it opens with the design's rules and what its framework reads", async () => {
    server.rules = {
      source: { path: "guidance.md", writable: true },
      intent: "Calm.",
      rules: [{ kind: "do", text: "One accent" }],
    };
    server.frameworkRoles = ["primary", "background"];
    await onBoard("main");
    await state().openLanguage("guided");
    expect(state().languageMode).toBe("guided");
    expect(state().languageRules).toEqual(server.rules);
    expect(state().frameworkRoles).toEqual(["primary", "background"]);
  });

  test("nothing stays selected behind it", async () => {
    await onBoard("main");
    useCanvas.setState({ selection: { screenId: "home", path: "0" } });
    await state().openLanguage();
    expect(state().selection).toBeNull();
  });
});

describe("Cancel", () => {
  test("sends back the theme as it stood on the way in, under its own name", async () => {
    await onBoard("night");
    await state().openLanguage();
    const entered = state().theme;
    edit({ radius: { md: "0rem" } });

    await state().cancelLanguage();
    // `rules: null` — the design followed no document when the stage opened.
    expect(server.restores).toEqual([{ theme: entered, name: "Night", rules: null }]);
    expect(state().view).toBe("boards");
    expect(state().languageBaseline).toBeNull();
  });

  test("puts the rules of the design's own guidance back as they were", async () => {
    server.rules = {
      source: { path: "guidance.md", writable: true },
      intent: "Calm.",
      rules: [{ kind: "do", text: "One accent" }],
    };
    await onBoard("main");
    await state().openLanguage();
    await state().saveRules({ intent: "Loud.", rules: [] });
    expect(server.rules.intent).toBe("Loud.");

    await state().cancelLanguage();
    expect(lastRestore().rules).toEqual({
      intent: "Calm.",
      rules: [{ kind: "do", text: "One accent" }],
    });
    expect(state().languageRules?.intent).toBe("Calm.");
  });

  test("rules stated for the first time in the visit are taken away again", async () => {
    await onBoard("main");
    await state().openLanguage();
    await state().saveRules({ intent: "", rules: [{ kind: "dont", text: "Gradients" }] });
    expect(server.rules.source).not.toBeNull();

    await state().cancelLanguage();
    expect(lastRestore().rules).toBeNull();
    expect(state().languageRules).toEqual({ source: null, intent: "", rules: [] });
  });

  test("leaves a repo's DESIGN.md out of it: there was never anything to put back", async () => {
    server.rules = {
      source: { path: "../DESIGN.md", writable: false },
      intent: "Calm.",
      rules: [],
    };
    await onBoard("main");
    await state().openLanguage();
    await state().cancelLanguage();
    expect("rules" in lastRestore()).toBe(false);
    expect(lastRestore().name).toBe("default");
  });

  test("the board is back on its own theme afterwards", async () => {
    await onBoard("main");
    await state().openLanguage("review", "Night");
    expect(state().themeName).toBe("Night");
    await state().cancelLanguage();
    expect(state().themeName).toBe("default");
    expect(state().theme?.name).toBe("default");
  });
});

describe("a theme made for the visit", () => {
  test("starts as a copy of the theme on screen, not of the default", async () => {
    await onBoard("night");
    await state().startTheme("Dusk");
    expect(server.themeWrites).toEqual([
      { op: "add_theme", args: { name: "Dusk", from: "Night" } },
    ]);
    expect([state().languageMode, state().languageTheme, state().languageThemeIsNew]).toEqual([
      "guided",
      "Dusk",
      true,
    ]);
    expect(state().theme?.name).toBe("Dusk");
  });

  test("is a draft: making it does not put the board on it", async () => {
    await onBoard("main");
    await state().startTheme("Dusk");
    expect(server.mutations).toEqual([]);
  });

  test("Cancel removes it, and has no theme to put back", async () => {
    await onBoard("main");
    await state().startTheme("Dusk");
    edit({ radius: { md: "0rem" } });
    await state().cancelLanguage();

    expect(server.restores).toEqual([{ rules: null }]);
    expect(themeOps()).toEqual(["add_theme", "remove_theme"]);
    expect(Object.keys(server.themes)).not.toContain("Dusk");
    expect(server.mutations).toEqual([]);
    expect(state().languageThemeIsNew).toBe(false);
    // Back on the theme the board had all along.
    expect(state().themeName).toBe("default");
  });

  test("Done is what puts the board on it, and it stays", async () => {
    await onBoard("main");
    await state().startTheme("Dusk");
    await state().finishLanguage();

    expect(server.mutations).toEqual([
      { op: "update_board", args: { boardId: "main", patch: { theme: "Dusk" } } },
    ]);
    expect(themeOps()).toEqual(["add_theme"]);
    expect(server.restores).toEqual([]);
    expect(state().view).toBe("boards");
  });

  test("with no board on screen there is nothing to pin, and the theme is still kept", async () => {
    await onBoard(null);
    await state().startTheme("Dusk");
    await state().finishLanguage();
    expect(server.mutations).toEqual([]);
    expect(Object.keys(server.themes)).toContain("Dusk");
  });

  test("a changed one is handed off for the board it was made for, and no other", async () => {
    await onBoard("main");
    await state().startTheme("Dusk");
    edit({ colors: { ...(state().theme as Theme).colors, primary: "#e11d48" } });
    await state().finishLanguage();
    expect(state().languageHandoff).toEqual({ theme: "Dusk", areas: ["colour"], boards: ["main"] });
  });
});

describe("Done", () => {
  test("writes nothing: the edits were live all along", async () => {
    await onBoard("main");
    await state().openLanguage();
    edit({ radius: { md: "0rem" } });
    await state().finishLanguage();
    expect(server.restores).toEqual([]);
    expect(server.themeWrites).toEqual([]);
    expect(server.mutations).toEqual([]);
    expect(state().view).toBe("boards");
  });

  test("hands off every board on that theme, naming each part that changed", async () => {
    await onBoard("main");
    await state().openLanguage();
    const before = state().theme as Theme;
    edit({
      palette: { success: "#16a34a" },
      typography: { ...before.typography, typesets: { default: { leading: 1.7 } } },
      radius: { md: "0rem" },
    } as Partial<Theme>);
    await state().saveRules({ intent: "Calm.", rules: [] });
    await state().finishLanguage();
    // `night` renders with another theme: this change is not its business.
    expect(state().languageHandoff).toEqual({
      theme: "default",
      areas: ["colour", "type", "corners", "rules"],
      boards: ["main", "docs"],
    });
  });

  test("a change to another theme is handed off for its boards only", async () => {
    await onBoard("night");
    await state().openLanguage();
    edit({ colorsDark: { background: "#000000" } } as Partial<Theme>);
    await state().finishLanguage();
    expect(state().languageHandoff).toEqual({
      theme: "Night",
      areas: ["colour"],
      boards: ["night"],
    });
  });

  test("nothing changed, nothing to hand off", async () => {
    await onBoard("main");
    await state().openLanguage();
    await state().finishLanguage();
    expect(state().languageHandoff).toBeNull();
  });
});

describe("the rules while they are being saved", () => {
  const rule = (text: string) => ({ kind: "do" as const, text });

  test("a save shows at once and settles on what the server kept", async () => {
    await onBoard("main");
    await state().openLanguage();
    const saving = state().saveRules({ intent: "Calm.", rules: [rule("One accent")] });
    expect(state().languageRules).toMatchObject({ source: null, intent: "Calm." });
    await saving;
    expect(state().languageRules?.source).toEqual({ path: "guidance.md", writable: true });
  });

  test("a save the server refuses goes back to what the server has, and says it failed", async () => {
    server.rules = { source: { path: "guidance.md", writable: true }, intent: "Calm.", rules: [] };
    await onBoard("main");
    await state().openLanguage();
    server.fail("/api/design-language/rules");

    await expect(state().saveRules({ intent: "Loud.", rules: [rule("Shout")] })).rejects.toThrow();
    expect(state().languageRules).toEqual(server.rules);
  });

  test("a refresh that arrives mid-save does not put the old rules back on screen", async () => {
    await onBoard("main");
    await state().openLanguage();
    server.slow("/api/design-language/rules", 30);
    const saving = state().saveRules({ intent: "Calm.", rules: [rule("One accent")] });
    // A `theme-changed` broadcast lands while the save is still on its way:
    // what the server can report is, for this instant, what is being replaced.
    server.frameworkRoles = ["primary"];
    await state().refreshLanguage();
    expect(state().languageRules?.intent).toBe("Calm.");
    expect(state().frameworkRoles).toEqual(["primary"]);
    await saving;
    expect(state().languageRules).toEqual(server.rules);
  });
});
