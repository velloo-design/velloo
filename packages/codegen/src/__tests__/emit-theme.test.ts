import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { emitGlobalsCss } from "../emit-theme/globals-css.ts";
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

    expect(result.files.length).toBe(4);
    const [css, typeset, tsConfig, tokens] = result.files;
    expect(css?.path.endsWith("app/globals.css")).toBe(true);
    expect(typeset?.path.endsWith("app/typeset.css")).toBe(true);
    expect(tsConfig?.path.endsWith("tailwind.config.ts")).toBe(true);
    expect(tokens?.path.endsWith("tokens.json")).toBe(true);

    if (!css || !tsConfig) throw new Error("expected both files");
    const cssOut = css.contents;
    expect(cssOut).toContain(`@import "tailwindcss"`);
    expect(cssOut).toContain(`@import "./typeset.css"`);
    // The scale's class literals live in @velloo/schema, so they must be
    // safelisted or `text-h1` never compiles in the user's app.
    expect(cssOut).toContain(`@source inline(`);
    expect(cssOut).toContain("--text-h1:");
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
    expect(result.files.length).toBe(3);
    expect(result.files[0]?.path.endsWith("app/globals.css")).toBe(true);
    expect(result.files[1]?.path.endsWith("app/typeset.css")).toBe(true);
    expect(result.files[2]?.path.endsWith("tokens.json")).toBe(true);
  });

  test("the typeset sheet carries the rhythm controls and the derived ladder", async () => {
    const theme: Theme = {
      ...buildDefaultTheme(),
      typography: {
        fontFamily: { sans: "Inter, sans-serif", display: '"Unbounded", sans-serif' },
        typesets: {
          default: { size: "1em", leading: 1.75, flow: "1.25em", fontHeading: "display" },
          compact: { size: 14, leading: 1.6, flow: "1em" },
        },
      },
    };
    const result = await emitTheme(theme, {
      outputDir: join(tmpdir(), `velloo-theme-typeset-${Date.now()}`),
      apply: false,
    });
    const sheet = result.files.find((f) => f.path.endsWith("typeset.css"));
    if (!sheet) throw new Error("expected a typeset.css artifact");

    expect(sheet.contents).toContain("--typeset-leading: 1.75");
    expect(sheet.contents).toContain("--typeset-font-heading: var(--font-display)");
    expect(sheet.contents).toContain(".typeset-compact");
    // Derived from the controls, not hardcoded.
    expect(sheet.contents).toContain("--text-h1: calc(var(--typeset-rhythm) * 2.5)");
    // Zero specificity so the app's own utilities still win.
    expect(sheet.contents).toContain(":where(.typeset h1)");
  }, 30_000);

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

  test("emits DTCG light/dark modes with structured colors and resolved dark fallbacks", async () => {
    const theme: Theme = {
      ...buildDefaultTheme(),
      colorsDark: { background: "#111827" },
      palette: { brand: "rgb(79 70 229)" },
      paletteDark: { brand: "oklch(0.7 0.18 275)" },
    };
    const result = await emitTheme(theme, {
      outputDir: join(tmpdir(), `velloo-theme-dtcg-${Date.now()}`),
      apply: false,
    });
    const tokens = result.files.find((file) => file.path.endsWith("tokens.json"));
    if (!tokens) throw new Error("expected tokens.json");
    const parsed = JSON.parse(tokens.contents);
    expect(parsed.light.color.background.$type).toBe("color");
    expect(parsed.light.color.background.$value.colorSpace).toBe("oklch");
    expect(parsed.dark.color.background.$value.colorSpace).toBe("srgb");
    expect(parsed.dark.color.foreground).toEqual(parsed.light.color.foreground);
    expect(parsed.dark.color.palette.brand.$value.colorSpace).toBe("oklch");
    expect(parsed.light.spacing[1]).toEqual({
      $type: "dimension",
      $value: { value: 4, unit: "px" },
    });
  });

  test("DTCG export warns and preserves unsupported CSS color expressions", async () => {
    const theme = buildDefaultTheme();
    theme.colors.background = "var(--app-background)";
    const result = await emitTheme(theme, {
      outputDir: join(tmpdir(), `velloo-theme-dtcg-warning-${Date.now()}`),
      apply: false,
    });
    const tokens = result.files.find((file) => file.path.endsWith("tokens.json"));
    const parsed = JSON.parse(tokens?.contents ?? "{}");
    expect(parsed.light.color.background).toEqual({
      $type: "string",
      $value: "var(--app-background)",
    });
    expect(result.warnings.some((warning) => warning.includes("light.color.background"))).toBe(
      true,
    );
  });

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

describe("emitGlobalsCss — injection hardening", () => {
  test("untrusted theme values can't break out of the emitted CSS", () => {
    const theme = buildDefaultTheme();
    theme.name = "evil */ } body { display:none } /*";
    theme.colors.background = "#fff; } body { background: url(//evil) } .x {";
    theme.palette = { "brand-500": "red; } .pwn {" };
    theme.spacing = { ...theme.spacing, gutter: "1rem;} *{color:red}" };
    theme.shadows = { card: "0 1px 2px #000; } evil {" };
    theme.animation = { spin: "1s linear infinite; } evil {" };
    theme.typography.googleFonts = ['Inter")}body{ background:red } @import url("//evil'];
    theme.keyframes = {
      "pulse } evil {": { "0%": { opacity: "0; } .x {" } },
    };

    const css = emitGlobalsCss(theme, {
      customCss: ".a{} </style><script>alert(1)</script>",
    });

    // The only breakout from a <style> raw-text element is the end-tag
    // sequence — neither may survive (a literal `<script>` *opening* tag is
    // inert inside CSS, so only the `</` forms matter).
    expect(css).not.toContain("</style");
    expect(css).not.toContain("</script");
    // The malicious palette/shadow/animation values are stripped of their
    // declaration-breakout `}` … `{` structure (comments the emitter writes
    // legitimately contain none of these on their own value lines).
    expect(css).not.toContain("} body {");
    expect(css).not.toContain("} evil {");
    expect(css).not.toContain("}body{");
    // A hostile keyframe name that isn't a valid ident is dropped entirely.
    expect(css).not.toContain("pulse } evil");
  });
});
