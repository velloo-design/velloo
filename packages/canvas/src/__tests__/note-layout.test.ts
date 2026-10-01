import { describe, expect, test } from "bun:test";
import { isStaleNote, placeNotes } from "../note-layout.ts";
import type { CanvasNoteEntry } from "../store/types.ts";

const frame = { id: "fr_home", x: 100, y: 50, w: 400, h: 300 };
const frames = [frame];
const rects = { fr_home: { "0": { x: 20, y: 30, w: 80, h: 40 } } };
const insets = { fr_home: { x: 0, y: 20 } };

const attached = (over: Partial<CanvasNoteEntry> = {}): CanvasNoteEntry => ({
  id: "note_a",
  width: 240,
  body: "tighten this",
  attachment: { frameId: "fr_home", screenId: "home", locator: "@cta" },
  resolved: [0],
  ...over,
});

const free: CanvasNoteEntry = { id: "note_f", x: 12, y: 34, width: 240, body: "beside" };

describe("placeNotes", () => {
  test("a free note sits at its own coordinates", () => {
    const { free: placed, attached: inline } = placeNotes([free], frames, rects, insets);
    expect(placed).toEqual([{ note: free, card: { x: 12, y: 34 } }]);
    expect(inline).toHaveLength(0);
  });

  test("an attached note sits inline, at its node's top-right corner, over the frame", () => {
    const { attached: inline } = placeNotes([attached()], frames, rects, insets);
    // frame.x + inset.x + rect.x + rect.w, frame.y + inset.y + rect.y
    expect(inline[0]?.marker).toEqual({ x: 100 + 0 + 20 + 80, y: 50 + 20 + 30 });
    expect(inline[0]?.stale).toBe(false);
  });

  test("a dragged attached note still sits on its node — inline is not a position", () => {
    const { attached: inline } = placeNotes([attached({ x: 900, y: 900 })], frames, rects, insets);
    expect(inline[0]?.marker).toEqual({ x: 200, y: 100 });
  });

  test("a note whose node is gone marks the frame's corner, as stale", () => {
    const { attached: inline } = placeNotes([attached({ resolved: null })], frames, rects, insets);
    expect(inline[0]?.marker).toEqual({ x: 100 + 400, y: 50 + 20 });
    expect(inline[0]?.stale).toBe(true);
  });

  test("a note whose frame left the board falls back to free placement", () => {
    const { free: placed } = placeNotes([attached({ x: 5, y: 6 })], [], rects, insets);
    expect(placed[0]?.card).toEqual({ x: 5, y: 6 });
  });
});

describe("isStaleNote", () => {
  test("only an attachment the screen no longer resolves is stale", () => {
    expect(isStaleNote(attached({ resolved: null }))).toBe(true);
    expect(isStaleNote(attached())).toBe(false);
    expect(isStaleNote(free)).toBe(false);
  });
});
