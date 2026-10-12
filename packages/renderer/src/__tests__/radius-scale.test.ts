import { describe, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { themeToCss } from "../theme-to-css.ts";

const theme = (radius: Theme["radius"]): Theme =>
  ({
    name: "default",
    colors: { background: "#fff", foreground: "#111", primary: "#4f46e5" },
    typography: {},
    spacing: {},
    radius,
  }) as Theme;

/**
 * `rounded-md` has to follow the theme, or a radius change moves nothing on a
 * Tailwind screen. The two shapes of theme are read differently because `md`
 * means a different thing in each.
 */
describe("the corner scale themeToCss gives the rounded-* utilities", () => {
  test("a base radius alone gets the shadcn ladder hung off it", () => {
    const css = themeToCss(theme({ md: "0.75rem" }));
    expect(css).toContain("--radius: 0.75rem;");
    expect(css).toContain("--radius-lg: var(--radius);");
    expect(css).toContain("--radius-md: max(0px, calc(var(--radius) - 2px));");
    expect(css).toContain("--radius-sm: max(0px, calc(var(--radius) - 4px));");
    expect(css).toContain("--radius-xl: calc(var(--radius) + 4px);");
  });

  test("a stated scale is honoured step by step, with no ladder over it", () => {
    // The scaffold's scale, which is also Tailwind's own — so existing designs
    // round exactly as they did.
    const css = themeToCss(theme({ sm: 4, md: 6, lg: 8, xl: 12 }));
    expect(css).toContain("--radius-sm: 4px;");
    expect(css).toContain("--radius-md: 6px;");
    expect(css).toContain("--radius-lg: 8px;");
    expect(css).toContain("--radius-xl: 12px;");
    expect(css).not.toContain("calc(var(--radius)");
  });

  test("a step named beside the base is that step; md is the base, not a step", () => {
    // What an import leaves for `--radius: 0.5rem` plus `--radius-xl: 1rem`.
    const css = themeToCss(theme({ md: "0.5rem", sm: 2, xl: "1rem" }));
    expect(css).toContain("--radius: 0.5rem;");
    expect(css).toContain("--radius-sm: 2px;");
    expect(css).toContain("--radius-xl: 1rem;");
    expect(css).toContain("--radius-md: max(0px, calc(var(--radius) - 2px));");
    expect(css).toContain("--radius-lg: var(--radius);");
  });

  test("no radius, no scale", () => {
    // The typeset rules read `var(--radius, …)` with a fallback; nothing declares one.
    expect(themeToCss(theme({}))).not.toMatch(/--radius(-[a-z0-9]+)?:/);
  });
});
