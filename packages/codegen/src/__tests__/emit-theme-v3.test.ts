import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { hslTriplet } from "../emit-theme/hsl.ts";
import { emitTheme } from "../emit-theme/index.ts";
import { parseThemeCss } from "../import-theme/parse-css.ts";

function buildTheme(): Theme {
  return {
    name: "v3-test",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
      border: "oklch(0.922 0 0)",
    },
    colorsDark: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
    },
    palette: { "brand-600": "#7c3aed" },
    typography: { fontFamily: { sans: "Inter, ui-sans-serif, sans-serif" } },
    spacing: { 0: 0, 2: 8, "icon-rail": "3.5rem" },
    radius: { md: 8 },
    shadows: { lift: "0 2px 8px rgb(0 0 0 / 0.12)" },
    container: { center: true, padding: "2rem", maxWidth: "1400px" },
    keyframes: { "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } } },
    animation: { "fade-in": "fade-in .3s ease-out" },
  };
}

function freshDir(suffix: string): string {
  const dir = join(tmpdir(), `velloo-theme-v3-${suffix}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("hslTriplet", () => {
  test("converts oklch/hex to shadcn triplets", () => {
    expect(hslTriplet("oklch(1 0 0)")).toBe("0 0% 100%");
    expect(hslTriplet("#000000")).toBe("0 0% 0%");
    expect(hslTriplet("hsl(222.2 47.4% 11.2%)")).toBe("222.2 47.4% 11.2%");
  });

  test("refuses alpha and garbage", () => {
    expect(hslTriplet("rgb(0 0 0 / 0.5)")).toBeNull();
    expect(hslTriplet("not-a-color")).toBeNull();
    expect(hslTriplet("var(--x)")).toBeNull();
  });
});

/** Look artifacts up by name — the file list's order is not part of the contract. */
function fileEndingWith(result: { files: { path: string; contents: string }[] }, suffix: string) {
  const file = result.files.find((f) => f.path.endsWith(suffix));
  if (!file) throw new Error(`expected an artifact ending in ${suffix}`);
  return file;
}

describe("emitTheme tailwindMajor 3", () => {
  test("emits velloo-theme.css + velloo.preset.cjs, never a v4 vocabulary", async () => {
    const outDir = freshDir("basic");
    const result = await emitTheme(buildTheme(), { outputDir: outDir, tailwindMajor: 3 });

    expect(result.files.length).toBe(4);
    const css = fileEndingWith(result, "velloo-theme.css");
    const preset = fileEndingWith(result, "velloo.preset.cjs");
    // Next to the default globals path, not the globals file itself.
    expect(css.path.endsWith("app/velloo-theme.css")).toBe(true);
    expect(preset.path.endsWith("velloo.preset.cjs")).toBe(true);

    expect(css.contents).not.toContain("@theme");
    expect(css.contents).not.toContain(`@import "tailwindcss"`);
    expect(css.contents).not.toContain("@custom-variant");
    expect(css.contents).toContain("@layer base");
    expect(css.contents).toContain("--background: 0 0% 100%;");
    expect(css.contents).toContain("--primary-foreground:");
    expect(css.contents).toContain("--brand-600:");
    expect(css.contents).toContain(".dark {");
    expect(css.contents).toContain("--radius: 8px;");
    expect(css.contents).toContain("border-color: hsl(var(--border));");

    const cjs = preset.contents;
    expect(cjs).toContain("module.exports =");
    expect(cjs).toContain('"darkMode": [\n    "class"\n  ]');
    expect(cjs).toContain("hsl(var(--primary) / <alpha-value>)");
    expect(cjs).toContain("hsl(var(--brand-600) / <alpha-value>)");
    expect(cjs).toContain('"lg": "var(--radius)"');
    expect(cjs).toContain('"md": "calc(var(--radius) - 2px)"');
    expect(cjs).toContain('"icon-rail": "3.5rem"');
    expect(cjs).toContain('"lift": "0 2px 8px rgb(0 0 0 / 0.12)"');
    expect(cjs).toContain('"fade-in"');
    expect(cjs).toContain('"center": true');
    expect(cjs).toContain('"2xl": "1400px"');
    // Numeric spacing stays Tailwind's own scale.
    expect(cjs).not.toContain('"2": "8"');
    // v3 has no `@source inline`, so the ladder's classes must be safelisted in
    // the preset or the Heading/Text defaults never compile.
    expect(cjs).toContain('"safelist"');
    expect(cjs).toContain('"text-h1"');
    expect(cjs).toContain('"var(--text-h1)"');

    const typeset = fileEndingWith(result, "velloo-typeset.css");
    expect(typeset.path.endsWith("app/velloo-typeset.css")).toBe(true);
    expect(typeset.contents).toContain("--text-h1: calc(var(--typeset-rhythm) * 2.5)");
    expect(typeset.contents).toContain(":where(.typeset h1)");

    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.notes.join("\n")).toContain("velloo-theme.css");
    expect(result.notes.join("\n")).toContain("velloo-typeset.css");
    expect(result.notes.join("\n")).toContain("presets");
  });

  test("cssPath places the theme file next to the given globals; cssOnly skips the preset", async () => {
    const outDir = freshDir("csspath");
    const result = await emitTheme(buildTheme(), {
      outputDir: outDir,
      tailwindMajor: 3,
      cssPath: "src/index.css",
      cssOnly: true,
    });
    expect(result.files.length).toBe(3);
    expect(fileEndingWith(result, "src/velloo-theme.css")).toBeDefined();
    // The typeset sheet follows the css path, not the output root.
    expect(fileEndingWith(result, "src/velloo-typeset.css")).toBeDefined();
    expect(result.files.some((f) => f.path.includes("velloo.preset"))).toBe(false);
  });

  test("a TS host config selects the .ts preset flavor", async () => {
    const outDir = freshDir("tsconfig");
    writeFileSync(join(outDir, "tailwind.config.ts"), "export default { content: [] };\n");
    const result = await emitTheme(buildTheme(), { outputDir: outDir, tailwindMajor: 3 });
    const preset = fileEndingWith(result, "velloo.preset.ts");
    expect(preset.contents).toContain("export default {");
  });

  test("alpha-carrying colors fall back to raw var() with a warning", async () => {
    const theme = buildTheme();
    theme.colors.border = "rgb(0 0 0 / 0.1)";
    const outDir = freshDir("alpha");
    const result = await emitTheme(theme, { outputDir: outDir, tailwindMajor: 3 });
    const css = fileEndingWith(result, "velloo-theme.css");
    const preset = fileEndingWith(result, "velloo.preset.cjs");
    expect(css.contents).toContain("--border: rgb(0 0 0 / 0.1);");
    expect(css.contents).toContain("border-color: var(--border);");
    expect(preset.contents).toContain('"border": "var(--border)"');
    expect(result.warnings.join("\n")).toContain("--border");
  });

  test("round-trips through parseThemeCss", async () => {
    const outDir = freshDir("roundtrip");
    const result = await emitTheme(buildTheme(), { outputDir: outDir, tailwindMajor: 3 });
    const css = result.files[0]?.contents ?? "";
    const parsed = parseThemeCss(css);
    expect(parsed.colors.background).toBe("hsl(0 0% 100%)");
    expect(parsed.colorsDark.background).toBe("hsl(0 0% 3.9%)");
    expect(parsed.colors.primary).toEqual({
      DEFAULT: "hsl(0 0% 9%)",
      foreground: "hsl(0 0% 98%)",
    });
    expect(parsed.palette["brand-600"]).toBeDefined();
    expect(parsed.radius).toBe("8px");
  });
});
