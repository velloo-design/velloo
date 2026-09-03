import { describe, expect, test } from "bun:test";
import type { Board } from "@velloo/schema";
import { resolveScreenshotMode } from "../screenshot-capture.ts";

function folderWithSchemes(schemes: Array<"light" | "dark" | undefined>) {
  const board: Board = {
    id: "main",
    name: "Main",
    frames: schemes.map((scheme, index) => ({
      id: `f${index}`,
      screen: "home",
      x: index * 100,
      y: 0,
      w: 100,
      h: 100,
      ...(scheme ? { scheme } : {}),
    })),
    groups: [],
  };
  return { boards: new Map([[board.id, board]]) };
}

describe("resolveScreenshotMode", () => {
  test("uses an agreed hosting-frame pin when mode is omitted", () => {
    expect(resolveScreenshotMode(folderWithSchemes(["dark", "dark"]), "home", undefined)).toEqual({
      ok: true,
      mode: "dark",
    });
  });

  test("an explicit mode wins even when hosting frames disagree", () => {
    expect(resolveScreenshotMode(folderWithSchemes(["light", "dark"]), "home", "light")).toEqual({
      ok: true,
      mode: "light",
    });
  });

  test("omitted mode reports disagreement instead of guessing", () => {
    const result = resolveScreenshotMode(folderWithSchemes(["light", "dark"]), "home", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Pass mode");
  });
});
