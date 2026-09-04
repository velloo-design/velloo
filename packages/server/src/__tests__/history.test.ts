import { describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { HistoryManager } from "../history.ts";

const screen = (name: string): Screen => ({ id: "s", name, tree: { $ref: "Box" } });

describe("undo history coalescing", () => {
  test("consecutive writes to one screen collapse into a single step", () => {
    const h = new HistoryManager();
    h.push({ kind: "screen", screenId: "s", screen: screen("a") });
    h.push({ kind: "screen", screenId: "s", screen: screen("b") });
    expect(h.depths().undo).toBe(1);
    // The entry kept is the *first* one — undo should reach the state before
    // the run, not the state one write ago.
    expect(h.popUndo()).toMatchObject({ screen: { name: "a" } });
  });

  test("writes to different screens each get a step", () => {
    const h = new HistoryManager();
    h.push({ kind: "screen", screenId: "one", screen: screen("a") });
    h.push({ kind: "screen", screenId: "two", screen: screen("b") });
    expect(h.depths().undo).toBe(2);
  });

  test("a named gesture merges however long the drag pauses", () => {
    const h = new HistoryManager();
    h.push({ kind: "screen", screenId: "s", screen: screen("a"), coalesceKey: "scrub-1" });
    const top = h.popUndo();
    expect(top).toBeDefined();
    // Backdate the entry well past the time window: only the gesture id can
    // hold these together, which is the point of naming it.
    if (top) h.pushUndoSilent({ ...top, ts: Date.now() - 60_000 });
    h.push({ kind: "screen", screenId: "s", screen: screen("b"), coalesceKey: "scrub-1" });
    expect(h.depths().undo).toBe(1);
    expect(h.popUndo()).toMatchObject({ screen: { name: "a" } });
  });

  test("a second gesture on the same screen is a second step", () => {
    const h = new HistoryManager();
    h.push({ kind: "screen", screenId: "s", screen: screen("a"), coalesceKey: "scrub-1" });
    h.push({ kind: "screen", screenId: "s", screen: screen("b"), coalesceKey: "scrub-2" });
    expect(h.depths().undo).toBe(2);
  });
});
