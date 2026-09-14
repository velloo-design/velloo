import { describe, expect, test } from "bun:test";
import * as lucide from "lucide-react";
import { glyphTable, resolveGlyph } from "../components/lucide-glyphs.ts";

const glyphs = glyphTable(lucide);

describe("resolveGlyph", () => {
  test("resolves exact export names", () => {
    expect(resolveGlyph(glyphs, "Check")).toBe(lucide.Check);
    expect(resolveGlyph(glyphs, "ChevronRight")).toBe(lucide.ChevronRight);
  });

  // The Icon helper renders these spellings, so the canvas's icon controls
  // must show the same glyph rather than a blank.
  test("resolves the lowercase, kebab and snake spellings the Icon helper accepts", () => {
    expect(resolveGlyph(glyphs, "check")).toBe(lucide.Check);
    expect(resolveGlyph(glyphs, "chevron-right")).toBe(lucide.ChevronRight);
    expect(resolveGlyph(glyphs, "square_pen")).toBe(lucide.SquarePen);
    expect(resolveGlyph(glyphs, "  Check ")).toBe(lucide.Check);
  });

  test("resolves lucide's renamed-icon aliases", () => {
    expect(resolveGlyph(glyphs, "HelpCircle")).toBe(lucide.CircleQuestionMark);
    expect(resolveGlyph(glyphs, "help-circle")).toBe(lucide.CircleQuestionMark);
  });

  test("never resolves the namespace's non-glyph exports", () => {
    for (const name of [
      "Icon",
      "icon",
      "icons",
      "createLucideIcon",
      "LucideProvider",
      "default",
      "toString",
      "constructor",
    ]) {
      expect(resolveGlyph(glyphs, name)).toBeUndefined();
    }
  });

  test("returns nothing for unknown or empty names, or before the set loads", () => {
    expect(resolveGlyph(glyphs, "not-an-icon-at-all")).toBeUndefined();
    expect(resolveGlyph(glyphs, "   ")).toBeUndefined();
    expect(resolveGlyph(null, "Check")).toBeUndefined();
  });
});
