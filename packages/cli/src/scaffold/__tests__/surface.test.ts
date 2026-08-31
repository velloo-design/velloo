import { describe, expect, test } from "bun:test";
import { buildSampleBoards, buildSampleScreens } from "../sample-page.ts";

describe("welcome sample", () => {
  test("ships every screen across three boards", () => {
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

  test("no board frame points at a screen the sample doesn't ship", () => {
    const screens = new Set(buildSampleScreens().map((s) => s.id));
    for (const board of buildSampleBoards()) {
      for (const frame of board.frames) {
        expect(screens.has(frame.screen)).toBe(true);
      }
    }
  });
});
