import { describe, expect, test } from "bun:test";
import {
  isCssIdent,
  neutralizeCssText,
  sanitizeCssTokenValue,
  sanitizeGoogleFontSpec,
} from "../css-sanitize.ts";

const NO_BREAKOUT = /[<>{};\\]/;

describe("sanitizeCssTokenValue", () => {
  test("strips element/declaration/comment breakout characters", () => {
    for (const hostile of [
      "#fff</style><script>alert(1)</script>",
      "red; } body { display:none",
      "red */ } evil {",
      "x\n} .evil { color: red",
    ]) {
      const out = sanitizeCssTokenValue(hostile);
      expect(out).not.toMatch(NO_BREAKOUT);
      expect(out).not.toContain("*/");
    }
  });

  test("preserves legitimate CSS values", () => {
    expect(sanitizeCssTokenValue("oklch(0.5 0.2 250)")).toBe("oklch(0.5 0.2 250)");
    expect(sanitizeCssTokenValue('"Cal Sans", sans-serif')).toBe('"Cal Sans", sans-serif');
    expect(sanitizeCssTokenValue("0 1px 2px rgba(0,0,0,.1)")).toBe("0 1px 2px rgba(0,0,0,.1)");
    expect(sanitizeCssTokenValue("clamp(1rem, 2vw, 3rem)")).toBe("clamp(1rem, 2vw, 3rem)");
  });

  test("result can never contain a style-element or declaration breakout", () => {
    const out = sanitizeCssTokenValue("</style><x>{};");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("{");
    expect(out).not.toContain("}");
    expect(out).not.toContain(";");
  });
});

describe("neutralizeCssText", () => {
  test("escapes the raw-text end-tag sequence so a style block can't be broken", () => {
    const out = neutralizeCssText(".x{color:red} </style><script>alert(1)</script>");
    expect(out).not.toContain("</style");
    expect(out).not.toContain("</script");
    expect(out).toContain("<\\/style");
    // Structural CSS is preserved.
    expect(out).toContain(".x{color:red}");
  });

  test("preserves inline SVG data-URIs (escape reads back as `/` in CSS)", () => {
    const out = neutralizeCssText('.x{background:url("data:image/svg+xml,<svg></svg>")}');
    expect(out).toContain("<\\/svg>");
    expect(out).not.toContain("</svg>");
  });
});

describe("sanitizeGoogleFontSpec", () => {
  test("preserves css2 family + axis syntax, folds spaces", () => {
    expect(sanitizeGoogleFontSpec("Cal Sans")).toBe("Cal+Sans");
    expect(sanitizeGoogleFontSpec("Inter:wght@400..700")).toBe("Inter:wght@400..700");
    expect(sanitizeGoogleFontSpec("Roboto:ital,wght@0,400;1,700")).toBe(
      "Roboto:ital,wght@0,400;1,700",
    );
  });

  test("drops attribute/url breakout characters", () => {
    const out = sanitizeGoogleFontSpec('Inter"><script>alert(1)</script>');
    expect(out).not.toMatch(/["'<>()\\]/);
    expect(sanitizeGoogleFontSpec('x")}body{')).toBe("xbody");
  });
});

describe("isCssIdent", () => {
  test("accepts token names, rejects anything with structure", () => {
    expect(isCssIdent("primary-600")).toBe(true);
    expect(isCssIdent("icon_rail")).toBe(true);
    expect(isCssIdent("x: red; } evil {")).toBe(false);
    expect(isCssIdent("a}b")).toBe(false);
    expect(isCssIdent("")).toBe(false);
  });
});
