import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { emitTheme } from "../emit-theme/index.ts";

function buildDefaultTheme(): Theme {
  return {
    name: "default",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
      secondary: { DEFAULT: "oklch(0.97 0 0)", foreground: "oklch(0.205 0 0)" },
      muted: { DEFAULT: "oklch(0.97 0 0)", foreground: "oklch(0.556 0 0)" },
      accent: { DEFAULT: "oklch(0.97 0 0)", foreground: "oklch(0.205 0 0)" },
      destructive: { DEFAULT: "oklch(0.577 0.245 27.325)", foreground: "oklch(0.985 0 0)" },
      border: "oklch(0.922 0 0)",
      ring: "oklch(0.708 0 0)",
    },
    typography: {
      fontFamily: {
        sans: "Inter, ui-sans-serif, system-ui, sans-serif",
        mono: "ui-monospace, SFMono-Regular, monospace",
      },
    },
    spacing: { 0: 0, 1: 4, 2: 8, 4: 16 },
    radius: { sm: 4, md: 6, lg: 8 },
  };
}

describe("emitTheme", () => {
  test("emits globals.css with @theme, color vars, font vars, and tailwind.config.ts", async () => {
    const outDir = join(tmpdir(), `velloo-theme-${Date.now()}`);
    const result = await emitTheme(buildDefaultTheme(), { outputDir: outDir, apply: false });

    expect(result.files.length).toBe(2);
    const [css, tsConfig] = result.files;
    expect(css?.path.endsWith("app/globals.css")).toBe(true);
    expect(tsConfig?.path.endsWith("tailwind.config.ts")).toBe(true);

    if (!css || !tsConfig) throw new Error("expected both files");
    const cssOut = css.contents;
    expect(cssOut).toContain(`@import "tailwindcss"`);
    expect(cssOut).toContain("@theme {");
    expect(cssOut).toContain("--color-background:");
    expect(cssOut).toContain("--color-primary:");
    expect(cssOut).toContain("--color-primary-foreground:");
    expect(cssOut).toContain("--color-ring:");
    expect(cssOut).toContain("--font-sans:");
    expect(cssOut).toContain("--font-mono:");
    expect(cssOut).toContain("--radius:");
    expect(cssOut).toContain("@layer base");
    // Font-loading TODO comment so the user knows wiring is on them.
    expect(cssOut).toMatch(/TODO.*font/);

    const tsOut = tsConfig.contents;
    expect(tsOut).toContain(`import type { Config } from "tailwindcss"`);
    expect(tsOut).toContain("content:");
    expect(tsOut).toContain("satisfies Config");
  }, 30_000);

  test("cssOnly skips tailwind.config.ts", async () => {
    const outDir = join(tmpdir(), `velloo-theme-css-${Date.now()}`);
    const result = await emitTheme(buildDefaultTheme(), {
      outputDir: outDir,
      cssOnly: true,
      apply: false,
    });
    expect(result.files.length).toBe(1);
    expect(result.files[0]?.path.endsWith("app/globals.css")).toBe(true);
  });

  test("writes files when apply is true", async () => {
    const outDir = join(tmpdir(), `velloo-theme-apply-${Date.now()}`);
    const result = await emitTheme(buildDefaultTheme(), { outputDir: outDir, apply: true });
    expect(result.files.every((f) => f.applied)).toBe(true);
    const first = result.files[0];
    if (!first) throw new Error("expected at least one file");
    const cssOnDisk = await Bun.file(first.path).text();
    expect(cssOnDisk).toBe(first.contents);
  }, 30_000);
});
