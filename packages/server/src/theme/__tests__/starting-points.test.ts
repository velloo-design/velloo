import { describe, expect, test } from "bun:test";
import { ThemeSchema } from "@velloo/schema";
import { designTheme, testContext } from "../../testing/design-folder.ts";
import { applyPreset } from "../apply-preset.ts";
import { scoreThemeContrast } from "../contrast.ts";
import { PRESET_NAMES } from "../presets.ts";
import { STARTING_POINTS, startingPointTheme } from "../starting-points.ts";

/**
 * A starting point replaces the look of a whole design in one click, so each
 * one has to land as a complete theme: valid, different in dark, and legible.
 */
describe("starting points", () => {
  const current = designTheme({
    typography: {
      fontFamily: { sans: "Inter, sans-serif", display: '"DM Serif Display", serif' },
      googleFonts: ["DM+Serif+Display"],
      typesets: { default: { leading: 1.6, fontBody: "sans", fontHeading: "display" } },
    },
  });

  for (const point of STARTING_POINTS) {
    test(`${point.name} is a complete light and dark theme`, () => {
      const built = startingPointTheme(point, current);
      if (!built.ok) throw new Error(built.error.kind);
      const theme = ThemeSchema.parse(built.value);
      expect(theme.colorsDark?.background).toBeDefined();
      expect(theme.colorsDark?.background).not.toBe(theme.colors.background);
      expect(theme.colorsDark?.primary).not.toEqual(theme.colors.primary);
      expect(theme.radius.md).toBe(`${point.radius / 16}rem`);
      expect(theme.typography.fontFamily?.sans).toBe(point.fonts.sans);
      for (const mode of ["light", "dark"] as const) {
        const failing = scoreThemeContrast(theme, mode).filter((r) => r.tier === "Fail");
        expect(failing.map((r) => `${mode}: ${r.label}`)).toEqual([]);
      }
    });
  }

  test("keeps the rhythm, and stops headings using the old display face", () => {
    const point = STARTING_POINTS[0];
    if (!point) throw new Error("no starting points");
    const built = startingPointTheme(point, current);
    if (!built.ok) throw new Error(built.error.kind);
    expect(built.value.typography.typesets?.default).toEqual({
      leading: 1.6,
      fontBody: "sans",
      fontMono: "mono",
    });
    // The display role is still declared, so its webfont is still wanted.
    expect(built.value.typography.googleFonts).toContain("DM+Serif+Display");
  });
});

describe("applyPreset", () => {
  test("every preset leaves a design whose dark mode is not its light mode", async () => {
    const t = await testContext({ label: "preset-dark" });
    try {
      for (const name of PRESET_NAMES) {
        const applied = await applyPreset(t.ctx.folder, name);
        if (!applied.ok) throw new Error(applied.error.kind);
        const { colors, colorsDark } = applied.value;
        // A preset that is dark to begin with has nothing darker to switch to.
        if (name === "default-dark") expect(colorsDark).toBeUndefined();
        else expect(colorsDark?.background).not.toBe(colors.background);
      }
    } finally {
      await t.cleanup();
    }
  });
});
