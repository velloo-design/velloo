import { describe, expect, test } from "bun:test";
import { sanitizeGoogleFontSpec } from "../css-sanitize.ts";
import { catalogFont, FONT_CATALOG, fontStack, fontsForRole, googleFontUrl } from "../fonts.ts";

/**
 * The catalogue is generated, so these guard the contract the picker and
 * `set_fonts` rely on rather than the editorial choices. The one thing they
 * cannot check is that Google still answers for every spec — that needs the
 * network, and `scripts/build-font-catalog.ts --verify` is where it happens.
 */
describe("FONT_CATALOG", () => {
  test("every family is distinct", () => {
    const names = FONT_CATALOG.map((f) => f.family);
    expect(new Set(names).size).toBe(names.length);
  });

  test("each entry can fill at least one role", () => {
    for (const font of FONT_CATALOG) {
      expect(font.roles.length).toBeGreaterThan(0);
    }
  });

  test("every role has something to offer", () => {
    for (const role of ["body", "display", "mono"] as const) {
      expect(fontsForRole(role).length).toBeGreaterThan(0);
    }
  });

  // A spec the sanitizer would rewrite is a spec that reaches Google as
  // something other than what was verified.
  test("axis specs survive the sanitizer the renderer puts them through", () => {
    for (const font of FONT_CATALOG) {
      if (font.google === true) continue;
      const entry = `${font.family.replace(/ /g, "+")}:${font.google}`;
      expect(sanitizeGoogleFontSpec(entry)).toBe(entry);
    }
  });

  test("stacks lead with the quoted family and carry a generic tail", () => {
    for (const font of FONT_CATALOG) {
      const stack = fontStack(font);
      expect(stack.startsWith(`"${font.family}", `)).toBe(true);
      expect(stack).toMatch(/(sans-serif|serif|monospace|cursive)$/);
    }
  });

  test("mono families are the ones offered for the mono role", () => {
    for (const font of fontsForRole("mono")) {
      expect(font.category).toBe("mono");
    }
  });

  test("catalogFont finds by exact family name", () => {
    expect(catalogFont("Inter")?.category).toBe("sans");
    expect(catalogFont("Not A Font")).toBeUndefined();
  });
});

describe("googleFontUrl", () => {
  test("folds spaces to + and keeps the axis spec verbatim", () => {
    const url = googleFontUrl("wght@400..700", "Space Grotesk");
    expect(url).toBe(
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&display=swap",
    );
  });

  test("a family with no axes asks for the family alone", () => {
    expect(googleFontUrl(true, "Anton")).toBe(
      "https://fonts.googleapis.com/css2?family=Anton&display=swap",
    );
  });

  // The subset request is what keeps an eighty-row list from pulling eighty
  // full webfonts, so the parameter has to actually reach the URL.
  test("text narrows the request to the glyphs being drawn", () => {
    expect(googleFontUrl(true, "Anton", "Anton")).toContain("&text=Anton");
  });
});
