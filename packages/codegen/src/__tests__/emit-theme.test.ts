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

  test("emits --shadow-* vars from theme.shadows", async () => {
    const theme: Theme = {
      ...buildDefaultTheme(),
      shadows: { card: "0 2px 8px rgba(0,0,0,0.06)", lift: "0 12px 32px rgba(0,0,0,0.12)" },
    };
    const result = await emitTheme(theme, {
      outputDir: join(tmpdir(), `velloo-theme-shadow-${Date.now()}`),
      apply: false,
    });
    const css = result.files[0]?.contents ?? "";
    // emitTheme post-formats the CSS (it normalizes rgba() spacing), so match
    // the formatting-stable parts rather than the raw token text.
    expect(css).toMatch(/--shadow-card:\s*0 2px 8px/);
    expect(css).toMatch(/--shadow-lift:\s*0 12px 32px/);
  });

  test("emits --spacing-* for named tokens only, not the numeric scale", async () => {
    const base = buildDefaultTheme();
    const theme: Theme = {
      ...base,
      // base.spacing carries the numeric scale ({0:0,1:4,…}); add named tokens on top.
      spacing: { ...base.spacing, "icon-rail": "3rem", header: "4rem" },
    };
    const result = await emitTheme(theme, {
      outputDir: join(tmpdir(), `velloo-theme-spacing-${Date.now()}`),
      apply: false,
    });
    const css = result.files[0]?.contents ?? "";
    expect(css).toMatch(/--spacing-icon-rail:\s*3rem/);
    expect(css).toMatch(/--spacing-header:\s*4rem/);
    // The built-in numeric scale must NOT be dumped (would shadow Tailwind, unitless).
    expect(css).not.toContain("--spacing-0:");
    expect(css).not.toContain("--spacing-1:");
  });

  test("emits @keyframes + --animate-* from theme.keyframes/animation", async () => {
    const theme: Theme = {
      ...buildDefaultTheme(),
      keyframes: { fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } } },
      animation: { "fade-in": "fadeIn 0.3s ease-out" },
    };
    const result = await emitTheme(theme, {
      outputDir: join(tmpdir(), `velloo-theme-kf-${Date.now()}`),
      apply: false,
    });
    const css = result.files[0]?.contents ?? "";
    expect(css).toMatch(/--animate-fade-in:\s*fadeIn 0\.3s ease-out/);
    expect(css).toContain("@keyframes fadeIn");
    expect(css).toMatch(/opacity:\s*0/);
  });

  test("emits @utility container from theme.container", async () => {
    const theme: Theme = {
      ...buildDefaultTheme(),
      container: { center: true, padding: "1.5rem", maxWidth: "1320px" },
    };
    const result = await emitTheme(theme, {
      outputDir: join(tmpdir(), `velloo-theme-container-${Date.now()}`),
      apply: false,
    });
    const css = result.files[0]?.contents ?? "";
    expect(css).toContain("@utility container");
    expect(css).toMatch(/margin-inline:\s*auto/);
    expect(css).toMatch(/padding-inline:\s*1\.5rem/);
    expect(css).toMatch(/max-width:\s*1320px/);
  });

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

  test("emits a .dark block when colorsDark is set", async () => {
    const theme: Theme = {
      ...buildDefaultTheme(),
      colorsDark: {
        background: "oklch(0.145 0 0)",
        foreground: "oklch(0.985 0 0)",
        primary: { DEFAULT: "oklch(0.985 0 0)", foreground: "oklch(0.205 0 0)" },
      },
    };
    const outDir = join(tmpdir(), `velloo-theme-dark-${Date.now()}`);
    const result = await emitTheme(theme, { outputDir: outDir, apply: false });
    const css = result.files[0]?.contents ?? "";
    expect(css).toContain("@custom-variant dark");
    expect(css).toContain(".dark {");
    expect(css).toMatch(/\.dark \{[\s\S]*--color-background: oklch\(0\.145 0 0\)/);
  }, 30_000);

  test("omits .dark block when colorsDark is absent", async () => {
    const theme = buildDefaultTheme();
    const outDir = join(tmpdir(), `velloo-theme-nodark-${Date.now()}`);
    const result = await emitTheme(theme, { outputDir: outDir, apply: false });
    const css = result.files[0]?.contents ?? "";
    expect(css).not.toContain(".dark {");
    expect(result.warnings).toEqual([]);
  }, 30_000);

  test("a palette token shadowing a semantic slot is skipped and warned about", async () => {
    // The velloo.design papercut: a brand `palette.muted` text color emitted a
    // second --color-muted that won in light mode, while `.dark` re-pointed
    // the same var at the semantic dark surface — body copy went invisible.
    const theme: Theme = {
      ...buildDefaultTheme(),
      colorsDark: { muted: { DEFAULT: "#1d1a14", foreground: "#a8a29e" } },
      palette: { muted: "#a59c8d", ink: "#1a1a1a" },
      paletteDark: { muted: "#a59c8d" },
    };
    const outDir = join(tmpdir(), `velloo-theme-shadow-${Date.now()}`);
    const result = await emitTheme(theme, { outputDir: outDir, apply: false });
    const css = result.files[0]?.contents ?? "";
    // Exactly one --color-muted per block: the semantic one (@theme + .dark).
    expect(css.match(/--color-muted:/g)?.length).toBe(2);
    expect(css).not.toContain("--color-muted: #a59c8d");
    // Non-colliding palette entries still pass through.
    expect(css).toContain("--color-ink: #1a1a1a;");
    // The skip is visible in the emitted CSS and in the result warnings.
    expect(css).toContain("palette.muted skipped");
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("`muted`");
    expect(result.warnings[0]).toContain("rename");
  }, 30_000);
});

describe("emitTheme contentGlobs", () => {
  test("custom globs land in the emitted tailwind.config.ts", async () => {
    const outDir = join(tmpdir(), `velloo-theme-globs-${Date.now()}`);
    const result = await emitTheme(buildDefaultTheme(), {
      outputDir: outDir,
      apply: false,
      contentGlobs: ["./src/**/*.{ts,tsx,astro}"],
    });
    const ts = result.files.find((f) => f.path.endsWith("tailwind.config.ts"));
    expect(ts?.contents).toContain('"./src/**/*.{ts,tsx,astro}"');
    expect(ts?.contents).not.toContain("./pages/**");
  });

  test("defaults keep the Next.js layout", async () => {
    const outDir = join(tmpdir(), `velloo-theme-globs-default-${Date.now()}`);
    const result = await emitTheme(buildDefaultTheme(), { outputDir: outDir, apply: false });
    const ts = result.files.find((f) => f.path.endsWith("tailwind.config.ts"));
    expect(ts?.contents).toContain('"./app/**/*.{ts,tsx}"');
    expect(ts?.contents).toContain('"./pages/**/*.{ts,tsx}"');
  });
});
