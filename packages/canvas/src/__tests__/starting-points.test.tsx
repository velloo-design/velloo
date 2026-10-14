import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import type { ReactElement } from "react";
import type { StartingPoint } from "../api.ts";
import { $, $$, domSuite, interact, mount, settle, text, typeInto } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * Where a language starts from: a direction, or one colour. Both replace the
 * palette wholesale, so the two things to hold are that they are aimed at the
 * theme being edited, and that a card claims to be the theme's direction only
 * while the server says the theme still is exactly that.
 */

const toasts: string[] = [];
mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: (_err: unknown, fallback: string) => {
    toasts.push(fallback);
    return "toast";
  },
}));

const { StartingPoints } = await import("../components/DesignLanguage/StartingPoints.tsx");
const { SeedPalette } = await import("../components/ThemeColors.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

const points: StartingPoint[] = [
  {
    id: "ink",
    name: "Ink",
    note: "Indigo · Inter · soft",
    primary: "rgb(79, 70, 229)",
    font: "Inter, sans-serif",
    radius: 8,
  },
  {
    id: "clay",
    name: "Clay",
    note: "Terracotta · Fraunces · sharp",
    primary: "rgb(194, 65, 12)",
    font: "Fraunces, serif",
    radius: 0,
  },
];

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

async function show(node: ReactElement, themeName = "default") {
  useCanvas.setState({ themeName, themeVersion: 1 });
  const view = await mount(node);
  views.push(view);
  await settle();
  return view;
}

const cards = () => $$("button[aria-pressed]");
const card = (name: string) => cards().find((el) => text(el).startsWith(name)) as HTMLButtonElement;
const lit = () =>
  cards()
    .filter((el) => el.getAttribute("aria-pressed") === "true")
    .map((el) => text(el.querySelector("[data-slot='item-title']")));

/** The theme changing underfoot — a write landing, by anyone. */
async function themeChanged(): Promise<void> {
  await interact(() => useCanvas.setState((s) => ({ themeVersion: s.themeVersion + 1 })));
  await settle();
}

beforeEach(() => {
  toasts.length = 0;
  server = serveFolder();
  server.startingPoints = points;
  setApiConnected(true);
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("starting points", () => {
  test("each card is drawn with what choosing it sets", async () => {
    await show(<StartingPoints />);
    expect(cards().map((el) => text(el))).toEqual([
      "InkIndigo · Inter · soft",
      "ClayTerracotta · Fraunces · sharp",
    ]);
    const chip = card("Clay").querySelector("[data-slot='item-media'] span") as HTMLElement;
    expect(chip.style.background).toBe("rgb(194, 65, 12)");
    expect(chip.style.borderRadius).toBe("0px");
    expect(
      (card("Ink").querySelector("[data-slot='item-media'] span") as HTMLElement).style
        .borderRadius,
    ).toBe("8px");
  });

  test("a design the server offers none for gets no picker at all", async () => {
    server.startingPoints = [];
    const view = await show(<StartingPoints />);
    expect(view.host.innerHTML).toBe("");
  });

  test("the card that is lit is the one the theme still exactly is", async () => {
    server.activeStartingPoint = "clay";
    await show(<StartingPoints />);
    expect(lit()).toEqual(["Clay"]);
  });

  test("choosing one applies it to the theme being edited", async () => {
    await show(<StartingPoints />, "Night");
    expect(server.calls).toContain("/api/theme/starting-points?name=Night");
    await interact(() => card("Ink").click());
    await settle();
    expect(server.themeWrites).toEqual([
      { op: "apply_starting_point", args: { id: "ink", theme: "Night" } },
    ]);
  });

  test("a click does not light a card; the theme having become it does", async () => {
    await show(<StartingPoints />);
    await interact(() => card("Ink").click());
    await settle();
    expect(lit()).toEqual([]);

    server.activeStartingPoint = "ink";
    await themeChanged();
    expect(lit()).toEqual(["Ink"]);
  });

  test("change anything it set and the theme is no longer that direction", async () => {
    server.activeStartingPoint = "ink";
    await show(<StartingPoints />);
    expect(lit()).toEqual(["Ink"]);

    // A role recoloured, the corners moved — by hand or by an agent.
    server.activeStartingPoint = null;
    await themeChanged();
    expect(lit()).toEqual([]);
  });

  test("a direction that could not be applied is reported", async () => {
    server.fail("/api/theme/apply_starting_point");
    await show(<StartingPoints />);
    await interact(() => card("Ink").click());
    await settle();
    expect(toasts).toEqual(["Could not apply the starting point"]);
  });
});

domSuite("a palette from one colour", () => {
  const seed = () => $("#theme-seed") as HTMLInputElement;
  const apply = () => $$("button").find((el) => text(el) === "Apply") as HTMLButtonElement;
  const theme = (primary: unknown) =>
    ({ name: "default", colors: { primary }, typography: {}, spacing: {}, radius: {} }) as Theme;

  test("there is nothing to apply until a colour is given", async () => {
    await show(<SeedPalette />);
    expect(apply().disabled).toBe(true);
    await interact(() => typeInto(seed(), "   "));
    expect(apply().disabled).toBe(true);
  });

  test("the swatch starts from the primary the theme has now", async () => {
    useCanvas.setState({ theme: theme({ DEFAULT: "rgb(79, 70, 229)", foreground: "#fff" }) });
    await show(<SeedPalette />);
    const swatch = $("button[aria-label='Edit derive palette from color']") as HTMLElement;
    expect(swatch.style.background).toBe("rgb(79, 70, 229)");
  });

  test("the default theme's palette is derived in place", async () => {
    await show(<SeedPalette />);
    await interact(() => typeInto(seed(), "  #7c3aed "));
    await interact(() => apply().click());
    await settle();
    // No `name`: that argument means a *new* theme to write the palette into.
    expect(server.themeWrites).toEqual([
      { op: "derive_palette_from_color", args: { seedColor: "#7c3aed" } },
    ]);
    expect(text(document.body)).toContain("palette derived from #7c3aed");
  });

  test("on another theme the palette is derived into that theme", async () => {
    await show(<SeedPalette />, "Night");
    await interact(() => typeInto(seed(), "oklch(0.6 0.2 280)"));
    await interact(() => apply().click());
    await settle();
    expect(server.themeWrites).toEqual([
      {
        op: "derive_palette_from_color",
        args: { seedColor: "oklch(0.6 0.2 280)", name: "Night" },
      },
    ]);
  });

  test("a colour the server cannot use is said beside the field, and can be tried again", async () => {
    server.fail("/api/theme/derive_palette_from_color", 422);
    await show(<SeedPalette />);
    await interact(() => typeInto(seed(), "not-a-colour"));
    await interact(() => apply().click());
    await settle();
    expect(text(document.body)).toContain("derive failed: theme/derive_palette_from_color: 422");
    expect(apply().disabled).toBe(false);
  });
});
