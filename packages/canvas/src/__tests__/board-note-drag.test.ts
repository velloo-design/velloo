import { describe, expect, test } from "bun:test";
import { noteFromDrag } from "../components/Board.tsx";

describe("noteFromDrag", () => {
  test("a click places a default-size note where it landed", () => {
    expect(noteFromDrag({ x0: 40, y0: 50, x1: 41, y1: 51 }, 1)).toEqual({ x: 40, y: 50 });
  });

  test("a drag gives the note the rectangle drawn, in any direction", () => {
    expect(noteFromDrag({ x0: 400, y0: 300, x1: 100, y1: 120 }, 1)).toEqual({
      x: 100,
      y: 120,
      width: 300,
      height: 180,
    });
  });

  test("a sliver of a drag is held to a legible minimum", () => {
    expect(noteFromDrag({ x0: 0, y0: 0, x1: 60, y1: 10 }, 1)).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 32,
    });
  });

  test("the click allowance is in screen pixels, so zoomed out a small board drag is still a click", () => {
    expect(noteFromDrag({ x0: 0, y0: 0, x1: 15, y1: 15 }, 0.25)).toEqual({ x: 0, y: 0 });
  });
});
