import { afterAll, beforeEach, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, text } from "./dom.ts";

/**
 * The Theme rail and the design-language stage edit a theme with the same
 * controls. What the rail adds is its subject — the theme the board on screen
 * uses — and what it leaves to the stage is everything that belongs to the
 * whole design.
 */

const theme = {
  name: "default",
  colors: { background: "#ffffff", foreground: "#111111", primary: "#4f46e5" },
  typography: {},
  spacing: {},
  radius: { md: "0.5rem" },
} as unknown as Theme;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/theme/contrast") return Response.json({ results: [] });
  if (url.pathname === "/api/theme/starting-points") {
    return Response.json({ startingPoints: [], active: null });
  }
  if (url.pathname === "/api/config") return Response.json({ themes: ["default", "night"] });
  throw new Error(`unexpected fetch: ${url.pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { ThemePanel } = await import("../components/ThemePanel.tsx");
const { useCanvas } = await import("../store.ts");

beforeEach(() => {
  localStorage.clear();
  useCanvas.setState({
    theme,
    themeName: "default",
    designMode: "light",
    frameworkRoles: null,
    wsConnected: true,
  });
});

domSuite("theme rail", () => {
  test("it is the stage's colour controls, pointed at the board's theme", async () => {
    const view = await mount(<ThemePanel theme={theme} />);
    try {
      const rail = text(document.body);
      expect(rail).toContain("Roles");
      expect(rail).toContain("Custom roles");
      expect(rail).toContain("Start over from a direction or a colour");
      // What belongs to the whole design stays in the stage.
      expect(rail).not.toContain("Intent");
      expect(rail).toContain("Open the design language");
    } finally {
      await view.unmount();
    }
  });

  test("the default theme is named for what it is", async () => {
    const view = await mount(<ThemePanel theme={theme} />);
    try {
      const options = $$("select[aria-label='Theme being edited'] option").map(text);
      expect(options[0]).toBe("Design language");
    } finally {
      await view.unmount();
    }
  });

  test("editing dark roles puts the board in dark", async () => {
    const view = await mount(<ThemePanel theme={theme} />);
    try {
      const dark = $$("[role='radio']").find((el) => text(el) === "Dark") as HTMLElement;
      await interact(() => dark.click());
      expect(useCanvas.getState().designMode).toBe("dark");
      expect($("#token-colorsDark\\.background")).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });
});
