import { describe, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { emitGlobalsCss } from "../emit-theme/globals-css.ts";
import { parseThemeCss } from "../import-theme/parse-css.ts";

function buildTheme(): Theme {
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
      input: "oklch(0.922 0 0)",
      ring: "oklch(0.708 0 0)",
    },
    colorsDark: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      primary: { DEFAULT: "oklch(0.922 0 0)", foreground: "oklch(0.205 0 0)" },
    },
    typography: {
      fontFamily: {
        sans: "Inter, ui-sans-serif, system-ui, sans-serif",
        mono: "ui-monospace, SFMono-Regular, monospace",
      },
    },
    spacing: { 0: 0, 1: 4 },
    radius: { md: "0.625rem" },
  };
}

describe("parseThemeCss round-trip", () => {
  test("parse(emitGlobalsCss(theme)) recovers colors, colorsDark, radius, fonts", () => {
    const theme = buildTheme();
    const css = emitGlobalsCss(theme);
    const parsed = parseThemeCss(css);

    expect(parsed.colors).toEqual(theme.colors);
    expect(parsed.colorsDark).toEqual(theme.colorsDark ?? {});
    expect(parsed.radius).toBe("0.625rem");
    expect(parsed.fontFamily).toEqual(theme.typography.fontFamily ?? {});
    expect(parsed.warnings).toEqual([]);
  });
});

describe("parseThemeCss stock shadcn (Tailwind v3 era)", () => {
  // The classic shadcn globals.css shape: HSL triplets, :root/.dark inside
  // @layer base, extra slots Velloo doesn't model (chart-*, sidebar-*).
  const V3_CSS = `
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
    --chart-1: 12 76% 61%;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
  }
}
`;

  test("HSL triplets wrap into hsl(), pairs assemble, dark stays overrides-only", () => {
    const parsed = parseThemeCss(V3_CSS);
    expect(parsed.colors.background).toBe("hsl(0 0% 100%)");
    expect(parsed.colors.primary).toEqual({
      DEFAULT: "hsl(222.2 47.4% 11.2%)",
      foreground: "hsl(210 40% 98%)",
    });
    expect(parsed.colors.card).toEqual({
      DEFAULT: "hsl(0 0% 100%)",
      foreground: "hsl(222.2 84% 4.9%)",
    });
    expect(parsed.colors.input).toBe("hsl(214.3 31.8% 91.4%)");
    expect(parsed.radius).toBe("0.5rem");

    expect(parsed.colorsDark.background).toBe("hsl(222.2 84% 4.9%)");
    expect(parsed.colorsDark.primary).toEqual({
      DEFAULT: "hsl(210 40% 98%)",
      foreground: "hsl(222.2 47.4% 11.2%)",
    });
    // Slots .dark doesn't re-declare must not leak in from :root.
    expect(parsed.colorsDark.card).toBeUndefined();
    expect(parsed.colorsDark.muted).toBeUndefined();
  });
});

describe("parseThemeCss stock shadcn (Tailwind v4 era)", () => {
  // v4 shape: oklch raw vars + @theme inline aliasing --color-* to var(--*).
  const V4_CSS = `
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-border: var(--border);
  --radius-sm: calc(var(--radius) - 4px);
}
`;

  test("var() indirection resolves; dark re-points raw vars", () => {
    const parsed = parseThemeCss(V4_CSS);
    expect(parsed.colors.background).toBe("oklch(1 0 0)");
    expect(parsed.colors.primary).toEqual({
      DEFAULT: "oklch(0.205 0 0)",
      foreground: "oklch(0.985 0 0)",
    });
    expect(parsed.colors.border).toBe("oklch(0.922 0 0)");
    expect(parsed.radius).toBe("0.625rem");
    expect(parsed.colorsDark.background).toBe("oklch(0.145 0 0)");
    expect(parsed.colorsDark.foreground).toBe("oklch(0.985 0 0)");
    expect(parsed.colorsDark.primary).toBeUndefined();
    expect(parsed.warnings).toEqual([]);
  });
});

describe("parseThemeCss edge cases", () => {
  test("prefers-color-scheme dark media block files :root vars as dark", () => {
    const css = `
:root { --background: #fff; --foreground: #111; --primary: #333; }
@media (prefers-color-scheme: dark) {
  :root { --background: #000; --foreground: #eee; }
}
`;
    const parsed = parseThemeCss(css);
    expect(parsed.colors.background).toBe("#fff");
    expect(parsed.colorsDark.background).toBe("#000");
    expect(parsed.colorsDark.foreground).toBe("#eee");
    expect(parsed.colorsDark.primary).toBeUndefined();
  });

  test("undefined var reference warns and skips the slot", () => {
    const css = `:root { --background: var(--does-not-exist); --foreground: #111; --primary: #333; }`;
    const parsed = parseThemeCss(css);
    expect(parsed.colors.background).toBeUndefined();
    expect(parsed.colors.foreground).toBe("#111");
    expect(parsed.warnings.length).toBe(1);
  });

  test("no recognizable tokens yields empty result, comments are inert", () => {
    const parsed = parseThemeCss(`/* --background: #fff; */ body { margin: 0; }`);
    expect(parsed.colors).toEqual({});
    expect(parsed.colorsDark).toEqual({});
    expect(parsed.radius).toBeUndefined();
  });

  test("font roles parse, sizing roles excluded", () => {
    const css = `:root {
  --background: #fff; --foreground: #111; --primary: #333;
  --font-sans: Inter, sans-serif;
  --font-display: "Unbounded", sans-serif;
  --font-size-base: 16px;
  --font-weight-bold: 700;
}`;
    const parsed = parseThemeCss(css);
    expect(parsed.fontFamily).toEqual({
      sans: "Inter, sans-serif",
      display: '"Unbounded", sans-serif',
    });
  });
});
