import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import { specimenScreen } from "../../specimen.ts";
import { testContext } from "../../testing/design-folder.ts";
import {
  addTheme,
  derivePaletteFromColor,
  removeTheme,
  renameTheme,
  restoreTheme,
  setCustomRole,
  setFonts,
} from "../index.ts";

const themeFiles = async (root: string) => (await readdir(join(root, "theme"))).sort();

/**
 * A theme's name is its file's, so it is what a person calls the theme — and
 * no more than a file name can carry on every platform a design is cloned to.
 */
describe("theme names", () => {
  test("a name is kept as typed: either case, with spaces", async () => {
    const t = await testContext({ label: "theme-names" });
    try {
      for (const name of ["Night", "Brand B", "high-contrast", "v2"]) {
        expect(unwrap(await addTheme(t.ctx, name)).theme.name).toBe(name);
      }
      expect(await themeFiles(t.root)).toEqual(
        ["Brand B.json", "Night.json", "default.json", "high-contrast.json", "v2.json"].sort(),
      );
      // It comes back under that name from disk, which is what a board pins.
      expect([...(await t.reload()).themes.keys()]).toContain("Brand B");
    } finally {
      await t.cleanup();
    }
  });

  test("refused: what a file name cannot carry, the default, and a name that differs only by case", async () => {
    const t = await testContext({ label: "theme-names" });
    try {
      unwrap(await addTheme(t.ctx, "Night"));
      for (const name of ["", "../up", "a/b", "trailing ", "dot.", "Default", "DEFAULT", "night"]) {
        expect((await addTheme(t.ctx, name)).ok).toBe(false);
      }
      expect(await themeFiles(t.root)).toEqual(["Night.json", "default.json"]);
    } finally {
      await t.cleanup();
    }
  });

  test("renaming only the case moves the one file instead of deleting it", async () => {
    const t = await testContext({ label: "theme-names" });
    try {
      unwrap(await addTheme(t.ctx, "night"));
      expect(unwrap(await renameTheme(t.ctx, "night", "Night")).name).toBe("Night");
      expect(await themeFiles(t.root)).toEqual(["Night.json", "default.json"]);
      expect([...(await t.reload()).themes.keys()].sort()).toEqual(["Night", "default"]);
    } finally {
      await t.cleanup();
    }
  });
});

describe("a theme other than the default", () => {
  test("is put back whole by name, and only if it exists", async () => {
    const t = await testContext({ label: "theme-restore" });
    try {
      const baseline = unwrap(await addTheme(t.ctx, "Night")).theme;
      unwrap(await setCustomRole(t.ctx, { name: "tertiary", light: "#00f" }, "Night"));
      expect(t.ctx.folder.themes.get("Night")?.palette?.tertiary).toBe("#00f");

      unwrap(await restoreTheme(t.ctx, baseline, "Night"));
      expect(t.ctx.folder.themes.get("Night")).toEqual(baseline);
      expect(t.ctx.folder.theme.palette?.tertiary).toBeUndefined();

      expect((await restoreTheme(t.ctx, baseline, "Gone")).ok).toBe(false);
      expect(await themeFiles(t.root)).toEqual(["Night.json", "default.json"]);
    } finally {
      await t.cleanup();
    }
  });

  test("seeded from a colour, it keeps its own faces", async () => {
    const t = await testContext({ label: "theme-derive" });
    try {
      unwrap(await addTheme(t.ctx, "Night"));
      unwrap(await setFonts(t.ctx, [{ role: "sans", family: "Manrope" }], "Night"));
      const face = t.ctx.folder.themes.get("Night")?.typography.fontFamily?.sans;
      expect(face).toContain("Manrope");

      const derived = unwrap(await derivePaletteFromColor(t.ctx, "#0f766e", "Night")).theme;
      expect(derived.typography.fontFamily?.sans).toBe(face);
      expect(t.ctx.folder.theme.typography.fontFamily?.sans).not.toBe(face);
    } finally {
      await t.cleanup();
    }
  });

  test("has its own specimen: a role only it defines is drawn", async () => {
    const t = await testContext({ label: "theme-specimen" });
    try {
      unwrap(await addTheme(t.ctx, "Night"));
      unwrap(await setCustomRole(t.ctx, { name: "tertiary", light: "#00f" }, "Night"));
      const drawn = async (theme?: string) =>
        JSON.stringify((await specimenScreen(t.ctx, theme)).tree).includes("tertiary");
      expect(await drawn("Night")).toBe(true);
      expect(await drawn()).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  test("made and then abandoned, it leaves nothing behind", async () => {
    const t = await testContext({ label: "theme-abandon" });
    try {
      unwrap(await addTheme(t.ctx, "Night"));
      unwrap(await removeTheme(t.ctx, "Night"));
      expect(await themeFiles(t.root)).toEqual(["default.json"]);
    } finally {
      await t.cleanup();
    }
  });
});
