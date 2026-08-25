import { describe, expect, test } from "bun:test";
import type { Board } from "@velloo/schema";
import type { MutationContext } from "../../../mutations/context.ts";
import { framesShorterThan } from "../screenshot-helpers.ts";

function ctxWithBoards(boards: Board[]): MutationContext {
  return {
    folder: { boards: new Map(boards.map((b) => [b.id, b])) },
  } as unknown as MutationContext;
}

const board: Board = {
  id: "b",
  name: "B",
  frames: [
    { id: "desktop", screen: "landing", x: 0, y: 0, w: 1440, h: 3000 },
    { id: "mobile", screen: "landing", x: 1600, y: 0, w: 390, h: 4000 },
    { id: "other-screen", screen: "pricing", x: 0, y: 3200, w: 1440, h: 900 },
  ],
  groups: [],
};

describe("framesShorterThan", () => {
  test("only frames at the capture width are flagged", () => {
    const ctx = ctxWithBoards([board]);
    // A 390-wide capture is much taller than any desktop render; the 1440
    // frame must NOT be flagged against it (mis-fit dogfood bug).
    const short = framesShorterThan(ctx, "landing", 5093, 390);
    expect(short.map((f) => f.frame)).toEqual(["mobile"]);
    expect(short[0]?.overflowBy).toBe(1093);
  });

  test("desktop capture flags only the same-width desktop frame", () => {
    const ctx = ctxWithBoards([board]);
    const short = framesShorterThan(ctx, "landing", 3500, 1440);
    expect(short.map((f) => f.frame)).toEqual(["desktop"]);
  });

  test("frames tall enough, other screens, and other widths stay unflagged", () => {
    const ctx = ctxWithBoards([board]);
    expect(framesShorterThan(ctx, "landing", 2500, 1440)).toEqual([]);
    expect(framesShorterThan(ctx, "pricing", 5000, 390)).toEqual([]);
  });
});
