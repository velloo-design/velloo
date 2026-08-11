import { describe, expect, test } from "bun:test";
import { scoreVibe, VIBE_TABLE } from "../vibe-table.ts";

describe("scoreVibe (heuristic)", () => {
  test("matches a known keyword", () => {
    const r = scoreVibe("playful");
    expect(r).not.toBeNull();
    expect(r?.entry.keywords).toContain("playful");
  });

  test("matches multi-word descriptions", () => {
    const r = scoreVibe("a calm professional brand");
    expect(r?.entry.keywords).toContain("professional");
  });

  test("returns null for an unrelated description", () => {
    const r = scoreVibe("blorflexicon");
    expect(r).toBeNull();
  });

  test("scores all entries equally <= 1", () => {
    const r = scoreVibe("warm cozy autumn rustic");
    expect(r).not.toBeNull();
    expect(r?.score ?? 0).toBeLessThanOrEqual(1);
  });

  test("every entry has at least one keyword", () => {
    for (const entry of VIBE_TABLE) {
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });
});
