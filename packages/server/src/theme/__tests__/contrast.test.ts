import { describe, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { contrastRatio, scoreThemeContrast, tierForRatio } from "../contrast.ts";

/**
 * WCAG contrast math is easy to get wrong silently — the readings look
 * plausible even when the formula is off by a factor. These tests pin
 * the known canonical pairs (black/white = 21:1, white/white = 1:1)
 * plus a few theme-shaped checks against the standard PRESETS.
 */

describe("contrastRatio", () => {
  test("black on white is exactly 21:1", () => {
    const r = contrastRatio("#000000", "#ffffff");
    expect(r).not.toBeNull();
    expect(r).toBeCloseTo(21, 1);
  });

  test("white on white is exactly 1:1", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 2);
  });

  test("contrast is order-independent", () => {
    const a = contrastRatio("#000000", "#ffffff");
    const b = contrastRatio("#ffffff", "#000000");
    expect(a).toBeCloseTo(b ?? 0, 4);
  });

  test("accepts oklch() colors via culori", () => {
    const r = contrastRatio("oklch(0.145 0 0)", "oklch(1 0 0)");
    expect(r).not.toBeNull();
    // Near-black on white should be very close to 21:1.
    expect(r ?? 0).toBeGreaterThan(15);
  });

  test("malformed inputs return null without throwing", () => {
    expect(contrastRatio("not-a-color", "#fff")).toBeNull();
    expect(contrastRatio("", "")).toBeNull();
  });
});

describe("tierForRatio", () => {
  test("classifies the WCAG breakpoints", () => {
    expect(tierForRatio(21)).toBe("AAA");
    expect(tierForRatio(7)).toBe("AAA");
    expect(tierForRatio(6.99)).toBe("AA");
    expect(tierForRatio(4.5)).toBe("AA");
    expect(tierForRatio(4.49)).toBe("AAlarge");
    expect(tierForRatio(3)).toBe("AAlarge");
    expect(tierForRatio(2.99)).toBe("Fail");
    expect(tierForRatio(1)).toBe("Fail");
  });
});

describe("scoreThemeContrast", () => {
  test("scores a high-contrast theme as mostly passing", () => {
    const theme: Theme = {
      name: "test",
      colors: {
        background: "#ffffff",
        foreground: "#000000",
        primary: { DEFAULT: "#000000", foreground: "#ffffff" },
        secondary: { DEFAULT: "#f5f5f5", foreground: "#000000" },
        muted: { DEFAULT: "#f5f5f5", foreground: "#5a5a5a" },
        accent: { DEFAULT: "#eeeeee", foreground: "#000000" },
        destructive: { DEFAULT: "#cc0000", foreground: "#ffffff" },
        card: { DEFAULT: "#ffffff", foreground: "#000000" },
        popover: { DEFAULT: "#ffffff", foreground: "#000000" },
        border: "#dddddd",
        input: "#dddddd",
        ring: "#bbbbbb",
      },
      typography: {},
      spacing: {},
      radius: {},
    };
    const results = scoreThemeContrast(theme);
    expect(results.length).toBeGreaterThan(0);
    const fails = results.filter((r) => r.tier === "Fail");
    expect(fails).toHaveLength(0);
  });

  test("flags low-contrast pairs", () => {
    const theme: Theme = {
      name: "low",
      colors: {
        background: "#ffffff",
        foreground: "#cccccc",
        primary: { DEFAULT: "#dddddd", foreground: "#eeeeee" },
        secondary: { DEFAULT: "#dddddd", foreground: "#eeeeee" },
        muted: { DEFAULT: "#dddddd", foreground: "#eeeeee" },
        accent: { DEFAULT: "#dddddd", foreground: "#eeeeee" },
        destructive: { DEFAULT: "#dddddd", foreground: "#eeeeee" },
        card: { DEFAULT: "#ffffff", foreground: "#cccccc" },
        popover: { DEFAULT: "#ffffff", foreground: "#cccccc" },
        border: "#dddddd",
        input: "#dddddd",
        ring: "#dddddd",
      },
      typography: {},
      spacing: {},
      radius: {},
    };
    const results = scoreThemeContrast(theme);
    const fails = results.filter((r) => r.tier === "Fail");
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.some((r) => r.label === "primary-foreground on primary")).toBe(true);
  });

  test("skips pairs with missing values silently (doesn't crash)", () => {
    const theme: Theme = {
      name: "sparse",
      colors: {
        background: "#ffffff",
        foreground: "#000000",
        primary: { DEFAULT: "#000000", foreground: "#ffffff" },
        secondary: { DEFAULT: "#ffffff", foreground: "#000000" },
        muted: { DEFAULT: "#ffffff", foreground: "#000000" },
        accent: { DEFAULT: "#ffffff", foreground: "#000000" },
        destructive: { DEFAULT: "#ff0000", foreground: "#ffffff" },
        card: { DEFAULT: "#ffffff", foreground: "#000000" },
        popover: { DEFAULT: "#ffffff", foreground: "#000000" },
        border: "#cccccc",
        input: "#cccccc",
        ring: "#999999",
      },
      typography: {},
      spacing: {},
      radius: {},
    };
    const results = scoreThemeContrast(theme);
    expect(results.length).toBeGreaterThan(0);
    // Every result should have a numeric ratio.
    for (const r of results) expect(r.ratio).toBeGreaterThan(0);
  });
});
