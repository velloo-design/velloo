import { describe, expect, test } from "bun:test";
import { ThemeSchema } from "@velloo/schema";
import { buildSampleBoards, buildSampleScreens } from "../sample-page.ts";
import { buildVibeTheme, VIBES } from "../vibes.ts";

/** Every frame on every board must point at a screen the surface ships. */
function assertBoardsResolve(surface?: "saas" | "analytics" | "marketing") {
  const screens = new Set(buildSampleScreens(surface).map((s) => s.id));
  for (const board of buildSampleBoards(surface)) {
    for (const frame of board.frames) {
      expect(screens.has(frame.screen)).toBe(true);
    }
  }
}

describe("product surface", () => {
  test("default (saas) is the full Pulse — unchanged from the historical scaffold", () => {
    expect(buildSampleScreens().map((s) => s.id)).toEqual([
      "landing",
      "pricing",
      "signup",
      "dashboard",
      "insights",
      "settings",
      "showcase",
    ]);
    expect(buildSampleBoards().map((b) => b.id)).toEqual(["app", "marketing", "playground"]);
  });

  test("analytics keeps the App board; marketing keeps the Marketing board", () => {
    expect(buildSampleBoards("analytics").map((b) => b.id)).toEqual(["app", "playground"]);
    expect(buildSampleScreens("analytics").map((s) => s.id)).toEqual([
      "dashboard",
      "insights",
      "settings",
      "showcase",
    ]);
    expect(buildSampleBoards("marketing").map((b) => b.id)).toEqual(["marketing", "playground"]);
    expect(buildSampleScreens("marketing").map((s) => s.id)).toEqual([
      "landing",
      "pricing",
      "signup",
      "showcase",
    ]);
  });

  test("no surface ships a board frame pointing at a missing screen", () => {
    assertBoardsResolve();
    assertBoardsResolve("saas");
    assertBoardsResolve("analytics");
    assertBoardsResolve("marketing");
  });
});

describe("vibes", () => {
  test("every vibe derives a schema-valid theme with its own primary", () => {
    const defaults = JSON.stringify(buildVibeTheme(undefined).colors.primary);
    for (const vibe of VIBES) {
      const theme = ThemeSchema.parse(buildVibeTheme(vibe.id));
      expect(JSON.stringify(theme.colors.primary)).not.toBe(defaults);
    }
  });

  test("an unknown vibe falls back to the default theme", () => {
    expect(buildVibeTheme("corporate-synergy")).toEqual(buildVibeTheme(undefined));
  });
});
