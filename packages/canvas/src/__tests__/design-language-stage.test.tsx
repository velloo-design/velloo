import { afterAll, beforeEach, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import type { DesignRulesState } from "../api.ts";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * The stage's two promises. Someone defining a language is shown one decision
 * at a time, and nothing reads as finished before they have been through it.
 * And Cancel means cancel: what was changed is put back, and nothing is
 * written when nothing was.
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

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/theme/contrast") return Response.json({ results: [] });
  if (url.pathname === "/api/theme/starting-points") return Response.json({ startingPoints: [] });
  if (url.pathname === "/api/theme/presets") return Response.json({ presets: [] });
  if (url.pathname === "/api/theme") return Response.json(theme);
  if (url.pathname === "/api/design-language/restore" && init?.method === "POST") {
    restored.push(JSON.parse(String(init.body)));
    return Response.json({ rules });
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

function open(mode: "guided" | "review"): void {
  useCanvas.setState({
    view: "language",
    wsConnected: true,
    theme,
    themeName: "default",
    languageMode: mode,
    languageRules: rules,
    languageBaseline: { theme, rules },
  });
}

beforeEach(() => {
  restored.length = 0;
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
      expect(restored).toEqual([{ theme, rules: null }]);
      expect(useCanvas.getState().view).toBe("boards");
    } finally {
      await view.unmount();
    }
  });
});
