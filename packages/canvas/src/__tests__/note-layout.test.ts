import { describe, expect, test } from "bun:test";
import { CARD_GUTTER } from "../annotation-layout.ts";
import { isStaleNote, planNotes } from "../note-layout.ts";
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

describe("planNotes", () => {
  test("a free note is positioned by its own coordinates and anchors nothing", () => {
    const plan = planNotes([free], frames, rects, insets);
    expect(plan.free).toEqual([{ note: free, card: { x: 12, y: 34 } }]);
    expect(plan.sections).toHaveLength(0);
  });

  test("an attached note is auto-placed beside its frame, against the node rect", () => {
    const plan = planNotes([attached()], frames, rects, insets);
    expect(plan.free).toHaveLength(0);
    const placed = plan.sections[0]?.placed[0];
    expect(plan.sections[0]?.frameId).toBe("fr_home");
    expect(placed?.card.x).toBe(frame.x + frame.w + CARD_GUTTER);
    // Board-world node rect: frame origin + iframe inset + iframe-local rect.
    expect(placed?.nodeRect).toEqual({ x: 120, y: 100, w: 80, h: 40 });
  });

  test("a dragged attached note honours its pinned coordinates but keeps its anchor", () => {
    const plan = planNotes([attached({ x: 700, y: 400 })], frames, rects, insets);
    const placed = plan.sections[0]?.placed[0];
    expect(placed?.card).toEqual({ x: 700, y: 400 });
    expect(placed?.nodeRect).not.toBeNull();
  });

  test("an unresolved anchor keeps the note beside the frame with nothing to connect to", () => {
    const plan = planNotes([attached({ resolved: null })], frames, rects, insets);
    const placed = plan.sections[0]?.placed[0];
    expect(placed).toBeDefined();
    expect(placed?.nodeRect).toBeNull();
    expect(isStaleNote(attached({ resolved: null }))).toBe(true);
    expect(isStaleNote(free)).toBe(false);
  });

  test("a note whose frame left the board degrades to free placement", () => {
    const orphan = attached({
      x: 5,
      y: 6,
      attachment: { frameId: "gone", screenId: "home", locator: "@cta" },
    });
    const plan = planNotes([orphan], frames, rects, insets);
    expect(plan.sections).toHaveLength(0);
    expect(plan.free[0]?.card).toEqual({ x: 5, y: 6 });
  });

  test("notes on different frames lay out against their own frame", () => {
    const second = { id: "fr_about", x: 900, y: 50, w: 300, h: 200 };
    const plan = planNotes(
      [
        attached({ id: "a" }),
        attached({
          id: "b",
          attachment: { frameId: "fr_about", screenId: "about", locator: "@cta" },
        }),
      ],
      [frame, second],
      rects,
      insets,
    );
    expect(plan.sections.map((s) => s.frameId)).toEqual(["fr_home", "fr_about"]);
    expect(plan.sections[1]?.placed[0]?.card.x).toBe(second.x + second.w + CARD_GUTTER);
  });

  test("two notes on the same node are nudged apart rather than stacked", () => {
    const plan = planNotes([attached({ id: "a" }), attached({ id: "b" })], frames, rects, insets);
    const [first, last] = plan.sections[0]?.placed ?? [];
    expect(first?.card.y).not.toBe(last?.card.y);
  });
});
