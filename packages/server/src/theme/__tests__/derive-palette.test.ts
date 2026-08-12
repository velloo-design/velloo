import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { wcagContrast } from "culori";
import { derivePalette } from "../derive-palette.ts";

const base: Theme = {
  name: "test",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

describe("derivePalette", () => {
  test("returns a complete colors object from a hex seed", () => {
    const r = unwrap(derivePalette("#7c3aed", base));
    expect(r.theme.colors.primary).toBeDefined();
    expect(r.theme.colors.secondary).toBeDefined();
    expect(r.theme.colors.muted).toBeDefined();
    expect(r.theme.colors.accent).toBeDefined();
    expect(r.theme.colors.destructive).toBeDefined();
    expect(r.theme.colors.border).toBeDefined();
  });

  test("primary/foreground pair meets WCAG-AA contrast", () => {
    const r = unwrap(derivePalette("#7c3aed", base));
    const primary = r.theme.colors.primary;
    if (typeof primary === "object") {
      expect(primary.foreground).toBeDefined();
      const ratio = wcagContrast(primary.foreground as string, primary.DEFAULT);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("returns InvalidColor err on unparseable seed", () => {
    const r = derivePalette("not a color", base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidColor");
  });

  test("preserves theme name unless overridden", () => {
    const r1 = unwrap(derivePalette("#7c3aed", base));
    expect(r1.theme.name).toBe("test");
    const r2 = unwrap(derivePalette("#7c3aed", base, "violet"));
    expect(r2.theme.name).toBe("violet");
  });
});
