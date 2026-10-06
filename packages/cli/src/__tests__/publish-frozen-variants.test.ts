import { describe, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { designBoard, designScreen, designTheme } from "@velloo/server/testing";
import { frozenVariantsOf } from "../publish/core.ts";

/**
 * Which copies of a screen a publish mounts and ships.
 *
 * Each one is a page load here and a file in the share, so the list is exactly
 * what a viewer can be shown and nothing else. The rule it follows is the
 * share viewer's: its dark switch exists only for a theme with a dark palette,
 * and without one a screen is dark only in a frame pinned dark. If the two
 * drift apart a viewer either waits on copies nobody can reach, or is shown a
 * screen redrawn from its tree — a different picture from the canvas.
 */

const dark: Theme["colorsDark"] = { background: "oklch(0.2 0 0)" };
const screen = designScreen("home");
const variants = (
  design: { theme: Theme; themes?: Map<string, Theme> },
  boards = [designBoard("main", ["home"])],
) =>
  frozenVariantsOf(screen, { theme: design.theme, themes: design.themes ?? new Map() }, boards).map(
    (variant) => `${variant.theme.name}/${variant.scheme}`,
  );

describe("frozenVariantsOf", () => {
  test("a theme with a dark palette is frozen in both schemes: the viewer can switch", () => {
    expect(variants({ theme: designTheme({ colorsDark: dark }) })).toEqual([
      "default/light",
      "default/dark",
    ]);
  });

  test("with no dark palette there is no switch, so no dark copy", () => {
    expect(variants({ theme: designTheme() })).toEqual(["default/light"]);
  });

  test("a frame pinned dark is shown dark whatever the palette", () => {
    const board = designBoard("main", ["home"]);
    board.frames = board.frames.map((frame) => ({ ...frame, scheme: "dark" as const }));
    expect(variants({ theme: designTheme() }, [board])).toEqual(["default/light", "default/dark"]);
  });

  test("a pin on another screen's frame does not count", () => {
    const board = designBoard("main", ["home", "other"]);
    board.frames = board.frames.map((frame) =>
      frame.screen === "other" ? { ...frame, scheme: "dark" as const } : frame,
    );
    expect(variants({ theme: designTheme() }, [board])).toEqual(["default/light"]);
  });

  test("each theme a board shows the screen in, by its own palette", () => {
    const brand = designTheme({ name: "brand", colorsDark: dark });
    const plain = designTheme({ name: "plain" });
    const themes = new Map([
      ["brand", brand],
      ["plain", plain],
    ]);
    expect(
      variants({ theme: designTheme(), themes }, [
        designBoard("a", ["home"], { theme: "brand" }),
        designBoard("b", ["home"], { theme: "plain" }),
        designBoard("c", ["other"], { theme: "unused" }),
      ]),
    ).toEqual(["default/light", "brand/light", "brand/dark", "plain/light"]);
  });

  test("a board naming a theme the design lacks falls back to the default, once", () => {
    const made = frozenVariantsOf(screen, { theme: designTheme(), themes: new Map() }, [
      designBoard("a", ["home"], { theme: "gone" }),
    ]);
    expect(made.map((variant) => variant.key)).toHaveLength(1);
    // Rendered as the design's own theme, which is what the board falls back to.
    expect(made[0]?.themeName).toBeUndefined();
  });

  test("every copy has its own key", () => {
    const keys = frozenVariantsOf(
      screen,
      { theme: designTheme({ colorsDark: dark }), themes: new Map() },
      [designBoard("main", ["home"])],
    ).map((variant) => variant.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
