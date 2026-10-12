import { afterAll, beforeEach, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import type { DesignRulesState } from "../api.ts";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * The stage's two promises. Someone defining a language is shown one decision
 * at a time, and nothing reads as finished before they have been through it.
 * And Cancel means cancel: what was changed is put back, nothing is written
 * when nothing was, and a theme made for the visit does not outlive it.
 */

const theme = {
  name: "default",
  colors: { background: "#ffffff", foreground: "#111111", primary: "#4f46e5" },
  // No declared face: the Type step previews each one it lists, and a test
  // has no business fetching a webfont.
  typography: {},
  spacing: {},
  radius: { md: "0.5rem" },
} as unknown as Theme;
const rules: DesignRulesState = { source: null, intent: "", rules: [] };

const restored: unknown[] = [];
/** Every other write the stage makes, as `path body`. */
const writes: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/theme/contrast") return Response.json({ results: [] });
  if (url.pathname === "/api/theme/starting-points") return Response.json({ startingPoints: [] });
  if (url.pathname === "/api/theme") return Response.json(theme);
  if (url.pathname === "/api/design-language/restore" && init?.method === "POST") {
    restored.push(JSON.parse(String(init.body)));
    return Response.json({ rules });
  }
  if (url.pathname === "/api/config") return Response.json({ themes: ["default", "Night"] });
  if (init?.method === "POST") {
    writes.push(`${url.pathname} ${String(init.body)}`);
    return Response.json({});
  }
  throw new Error(`unexpected fetch: ${url.pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { LanguageStage } = await import("../components/DesignLanguage/LanguageStage.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

const tab = (name: string) =>
  $$("[data-language-stage] [role='tab']").find((el) => text(el) === name) as HTMLButtonElement;
const button = (name: string) =>
  $$("button").find((el) => text(el).startsWith(name)) as HTMLButtonElement | undefined;

function open(mode: "guided" | "review", themeName = "default", isNew = false): void {
  useCanvas.setState({
    view: "language",
    wsConnected: true,
    theme,
    themeName,
    languageTheme: themeName,
    languageThemeIsNew: isNew,
    folderConfig: null,
    currentBoardId: null,
    boards: {},
    languageMode: mode,
    languageRules: rules,
    languageBaseline: { theme, rules },
  });
}

beforeEach(() => {
  restored.length = 0;
  writes.length = 0;
  setApiConnected(true);
});

domSuite("design language stage", () => {
  test("guided: one step at a time, and Done only at the end", async () => {
    open("guided");
    const view = await mount(<LanguageStage />);
    try {
      expect(tab("Colour").disabled).toBe(false);
      expect(tab("Type").disabled).toBe(true);
      expect(tab("Rules").disabled).toBe(true);
      expect(button("Done")).toBeUndefined();
      // Colour → Shape via the tabs is not possible; Next is the way forward.
      await interact(() => button("Next: Type")?.click());
      expect(tab("Type").disabled).toBe(false);
      expect(tab("Shape").disabled).toBe(true);
      expect(text($("[data-language-stage]"))).toContain("Step 2 of 4.");
    } finally {
      await view.unmount();
    }
  });

  test("review: every step is open and nothing is ticked", async () => {
    open("review");
    const view = await mount(<LanguageStage />);
    try {
      expect(
        $$("[data-language-stage] nav button").map((el) => (el as HTMLButtonElement).disabled),
      ).toEqual([false, false, false, false]);
      expect($("[data-language-stage] .lucide-check")).toBeNull();
      expect(button("Done")).toBeDefined();
    } finally {
      await view.unmount();
    }
  });

  test("Cancel with nothing changed leaves without writing", async () => {
    open("review");
    const view = await mount(<LanguageStage />);
    try {
      await interact(() => button("Cancel")?.click());
      await settle(20);
      expect(restored).toEqual([]);
      expect(useCanvas.getState().view).toBe("boards");
    } finally {
      await view.unmount();
    }
  });

  test("Cancel after a change asks, then puts the baseline back", async () => {
    open("review");
    const view = await mount(<LanguageStage />);
    try {
      // An edit made in the stage arrives as a changed theme in the store.
      await interact(() => useCanvas.setState({ theme: { ...theme, radius: { md: "0rem" } } }));
      await interact(() => button("Cancel")?.click());
      expect(restored).toEqual([]);
      await interact(() => button("Discard")?.click());
      await settle(20);
      // `rules: null` — the design followed no document when the stage opened.
      expect(restored).toEqual([{ theme, name: "default", rules: null }]);
      expect(useCanvas.getState().view).toBe("boards");
    } finally {
      await view.unmount();
    }
  });

  test("review: where to start from waits below the roles, closed", async () => {
    open("review");
    const view = await mount(<LanguageStage />);
    try {
      const stage = text($("[data-language-stage]"));
      expect(stage.indexOf("Roles")).toBeLessThan(stage.indexOf("Start over from a direction"));
      expect(stage).not.toContain("derive palette from color");
    } finally {
      await view.unmount();
    }
  });

  test("guided: where to start from leads", async () => {
    open("guided");
    const view = await mount(<LanguageStage />);
    try {
      const stage = text($("[data-language-stage]"));
      expect(stage.indexOf("Start from a direction")).toBeLessThan(stage.indexOf("Roles"));
      expect(stage).toContain("derive palette from color");
    } finally {
      await view.unmount();
    }
  });

  test("a change kept on a design with boards raises the handoff; without boards it does not", async () => {
    type Boards = ReturnType<typeof useCanvas.getState>["boards"];
    const boards = {
      main: { id: "main", name: "Main", frames: [] },
      // On another theme: a change to the default is not this board's business.
      night: { id: "night", name: "Night shift", frames: [], theme: "Night" },
    } as unknown as Boards;
    for (const [held, expected] of [
      [boards, { theme: "default", areas: ["corners"], boards: ["Main"] }],
      [{} as Boards, null],
    ] as const) {
      open("review");
      useCanvas.setState({ languageHandoff: null, boards: held });
      const view = await mount(<LanguageStage />);
      try {
        await interact(() => useCanvas.setState({ theme: { ...theme, radius: { md: "0rem" } } }));
        await interact(() => button("Done")?.click());
        await settle(20);
        expect<unknown>(useCanvas.getState().languageHandoff).toEqual(expected);
      } finally {
        await view.unmount();
      }
    }
  });

  test("opened on another theme, it says which and Cancel puts that theme back", async () => {
    open("review", "Night");
    const view = await mount(<LanguageStage />);
    try {
      expect(text($("[data-language-theme]"))).toBe("Night");
      await interact(() => useCanvas.setState({ theme: { ...theme, radius: { md: "0rem" } } }));
      await interact(() => button("Cancel")?.click());
      await interact(() => button("Discard")?.click());
      await settle(20);
      expect(restored).toEqual([{ theme, name: "Night", rules: null }]);
      expect(writes).toEqual([]);
    } finally {
      await view.unmount();
    }
  });

  test("a design with one theme is not told which theme it is on", async () => {
    open("review");
    const view = await mount(<LanguageStage />);
    try {
      expect($("[data-language-theme]")).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  test("a new theme is a draft: Cancel removes it, even untouched", async () => {
    open("guided", "Night", true);
    useCanvas.setState({ currentBoardId: "main" });
    const view = await mount(<LanguageStage />);
    try {
      await interact(() => button("Cancel")?.click());
      await settle(20);
      // Nothing to restore the theme to — it goes — and the board was never put on it.
      expect(restored).toEqual([{ rules: null }]);
      expect(writes).toEqual(['/api/theme/remove_theme {"name":"Night"}']);
      expect(useCanvas.getState().view).toBe("boards");
    } finally {
      await view.unmount();
    }
  });

  test("a new theme: Done is what puts the board on it", async () => {
    open("guided", "Night", true);
    useCanvas.setState({ currentBoardId: "main" });
    const view = await mount(<LanguageStage />);
    try {
      for (const next of ["Next: Type", "Next: Shape", "Next: Rules"]) {
        await interact(() => button(next)?.click());
      }
      expect(writes).toEqual([]);
      await interact(() => button("Done")?.click());
      await settle(20);
      expect(writes).toEqual([
        '/api/mutate/update_board {"boardId":"main","patch":{"theme":"Night"}}',
      ]);
      expect(restored).toEqual([]);
    } finally {
      await view.unmount();
    }
  });
});
