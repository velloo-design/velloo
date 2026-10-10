import { describe, expect, test } from "bun:test";
import { ThemeSchema } from "@velloo/schema";
import { designTheme, testContext } from "../../testing/design-folder.ts";
import { applyPreset } from "../apply-preset.ts";
import { scoreThemeContrast } from "../contrast.ts";
import { setCustomRole, setRadius, setToken } from "../index.ts";
import { PRESET_NAMES } from "../presets.ts";
import { matchingStartingPoint, STARTING_POINTS, startingPointTheme } from "../starting-points.ts";

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

  test("eight, and no two alike in colour, face or corners", () => {
    expect(STARTING_POINTS).toHaveLength(8);
    for (const key of ["primary", "radius"] as const) {
      expect(new Set(STARTING_POINTS.map((p) => p[key])).size).toBe(8);
    }
    expect(new Set(STARTING_POINTS.map((p) => p.fonts.display ?? p.fonts.sans)).size).toBe(8);
  });

  test("keeps the rhythm, and stops headings using the old display face", () => {
    const point = STARTING_POINTS.find((p) => p.fonts.display === undefined && p.fonts.mono);
    if (!point) throw new Error("no single-face starting point");
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

  test("a theme is a starting point only while it is exactly that one", async () => {
    const t = await testContext({ label: "starting-point-match" });
    try {
      expect(matchingStartingPoint(t.ctx.folder.theme)).toBeNull();
      const { applyStartingPoint } = await import("../index.ts");
      await applyStartingPoint(t.ctx, "ember");
      expect(matchingStartingPoint(t.ctx.folder.theme)).toBe("ember");
      // Rhythm is not something a starting point decides, so changing it keeps the match…
      await setToken(t.ctx, "typography.typesets.default.leading", 1.4);
      expect(matchingStartingPoint(t.ctx.folder.theme)).toBe("ember");
      // …and a recoloured role, in either palette, ends it.
      await setToken(t.ctx, "colorsDark.border", "oklch(0.4 0 0)");
      expect(matchingStartingPoint(t.ctx.folder.theme)).toBeNull();
      await applyStartingPoint(t.ctx, "ember");
      await setRadius(t.ctx, "0rem");
      expect(matchingStartingPoint(t.ctx.folder.theme)).toBeNull();
    } finally {
      await t.cleanup();
    }
  });
});

describe("corner radius and custom roles", () => {
  test("setRadius replaces the scale rather than patching one step of it", async () => {
    const t = await testContext({
      label: "set-radius",
      theme: { radius: { sm: 4, md: 6, lg: 8, xl: 12, full: 9999 } },
    });
    try {
      const set = await setRadius(t.ctx, "1rem");
      expect(set.ok && set.value.radius).toEqual({ full: 9999, md: "1rem" });
    } finally {
      await t.cleanup();
    }
  });

  test("a custom role gets a light and a dark colour, and goes as one", async () => {
    const t = await testContext({ label: "custom-role" });
    try {
      const added = await setCustomRole(t.ctx, { name: "success", light: "#16a34a" });
      expect(added.ok && [added.value.palette, added.value.paletteDark]).toEqual([
        { success: "#16a34a" },
        { success: "#16a34a" },
      ]);
      const recoloured = await setCustomRole(t.ctx, { name: "success", dark: "#4ade80" });
      expect(recoloured.ok && recoloured.value.paletteDark).toEqual({ success: "#4ade80" });
      const clash = await setCustomRole(t.ctx, { name: "primary", light: "#000" });
      expect(clash.ok).toBe(false);
      const removed = await setCustomRole(t.ctx, { name: "success", remove: true });
      expect(removed.ok && [removed.value.palette, removed.value.paletteDark]).toEqual([
        undefined,
        undefined,
      ]);
    } finally {
      await t.cleanup();
    }
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
