import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { themeToCss } from "@velloo/renderer";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { designConfig, designTheme } from "../../testing/design-folder.ts";

import type { WatchEvent } from "../../watcher.ts";
import { importThemeCss, type ThemeContext } from "../index.ts";

const sampleConfig = designConfig({
  library: { componentsPath: "components/ui" },
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
});
const sampleTheme = designTheme({
  colors: { primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" } },
});
const sampleScreen = {
  id: "onboarding",
  name: "Onboarding",
  tree: { $ref: "Card", children: [] },
};

const HOST_APP_CSS = `
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --primary: 142.1 76.2% 36.3%;
    --primary-foreground: 355.7 100% 97.3%;
    --border: 240 5.9% 90%;
    --radius: 0.75rem;
  }
  .dark {
    --background: 20 14.3% 4.1%;
    --foreground: 0 0% 95%;
  }
}
`;

const HOST_TW_CONFIG = `
import type { Config } from "tailwindcss";
export default {
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1320px" } },
    extend: {
      colors: {
        paprika: "#E2571E",
        teal: "#0FA3A3",
        brand: { 500: "#123456" },
      },
      spacing: {
        "icon-rail": "3rem",
        header: "4rem",
      },
      boxShadow: {
        card: "0 2px 8px rgba(0,0,0,0.06)",
        lift: "0 12px 32px rgba(0,0,0,0.12)",
      },
      fontFamily: { display: ["Fraunces", "serif"] },
    },
  },
} satisfies Config;
`;

let tmp: string;
let folder: DesignFolder;
let ctx: ThemeContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
async function diskTheme(): Promise<Theme> {
  return JSON.parse(await readFile(join(tmp, "theme/default.json"), "utf8")) as Theme;
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-import-css-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/onboarding.json"), sampleScreen);
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = { folder, broadcast: (e) => events.push(e) };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("importThemeCss", () => {
  test("dry-run reports changes without persisting or broadcasting", async () => {
    const r = unwrap(await importThemeCss(ctx, HOST_APP_CSS));
    expect(r.applied).toBe(false);
    const tokens = r.changes.map((c) => c.token);
    expect(tokens).toContain("colors.background");
    expect(tokens).toContain("colors.primary.DEFAULT");
    expect(tokens).toContain("colorsDark.background");
    expect(tokens).toContain("radius.md");
    const bg = r.changes.find((c) => c.token === "colors.background");
    expect(bg?.from).toBe("oklch(1 0 0)");
    expect(bg?.to).toBe("hsl(0 0% 100%)");

    const onDisk = await diskTheme();
    expect(onDisk.colors.background).toBe("oklch(1 0 0)");
    expect(events).toEqual([]);
  });

  test("apply persists the merge and broadcasts theme-changed", async () => {
    const r = unwrap(await importThemeCss(ctx, HOST_APP_CSS, { apply: true }));
    expect(r.applied).toBe(true);

    const onDisk = await diskTheme();
    expect(onDisk.colors.background).toBe("hsl(0 0% 100%)");
    expect(onDisk.colors.primary).toEqual({
      DEFAULT: "hsl(142.1 76.2% 36.3%)",
      foreground: "hsl(355.7 100% 97.3%)",
    });
    expect(onDisk.colors.border).toBe("hsl(240 5.9% 90%)");
    expect(onDisk.colorsDark?.background).toBe("hsl(20 14.3% 4.1%)");
    expect(onDisk.radius.md).toBe("0.75rem");
    expect(events.filter((e) => e.type !== "activity").at(-1)).toEqual({
      type: "theme-changed",
    });
  });

  test("reads explicit radius steps and named shadows from @theme", async () => {
    // Tailwind v4 apps set these in `@theme` rather than deriving them from
    // `--radius`, and draw elevation with `shadow-<name>` utilities.
    const css = `@theme inline {
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-xs: 0.25rem;
  --shadow-edge: var(--edge-rest);
}
:root {
  --background: oklch(1 0 0);
  --edge-rest: inset 0 0 0 1px oklch(0.915 0.007 85);
}`;
    const r = unwrap(await importThemeCss(ctx, css, { apply: true }));
    expect(r.theme.radius).toMatchObject({ sm: "0.5rem", md: "0.75rem" });
    expect(r.theme.shadows).toMatchObject({ edge: "inset 0 0 0 1px oklch(0.915 0.007 85)" });
    expect(r.warnings.join(" ")).toContain("--radius-xs");
  });

  test("a stock shadcn or tweakcn sheet keeps its --radius anchor and real shadows", async () => {
    const css = `:root {
  --background: oklch(1 0 0);
  --radius: 0.625rem;
  --shadow-color: hsl(0 0% 0%);
  --shadow-opacity: 0.1;
  --shadow-sm: 0 1px 2px 0 hsl(0 0% 0% / 0.1);
}
@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --shadow-sm: var(--shadow-sm);
}`;
    const r = unwrap(await importThemeCss(ctx, css, { apply: true }));
    expect(r.theme.radius?.md).toBe("0.625rem");
    expect(r.theme.shadows).toMatchObject({ sm: "0 1px 2px 0 hsl(0 0% 0% / 0.1)" });
    expect(Object.keys(r.theme.shadows ?? {})).not.toContain("color");
    expect(Object.keys(r.theme.shadows ?? {})).not.toContain("opacity");
  });

  describe("onto a theme that already has a corner scale", () => {
    // What `velloo init` scaffolds: Tailwind's own scale, stated step by step.
    const SCAFFOLD_RADIUS = { sm: 4, md: 6, lg: 8, xl: 12, full: 9999 };
    const SQUARE_APP_CSS = `:root {
  --background: 0 0% 100%;
  /* Nothing is rounded in this system. */
  --radius: 0rem;
}`;
    // A Tailwind v3 app keeps its ladder in the config, and need not use shadcn's.
    const FLAT_V3_CONFIG = `export default {
  theme: {
    extend: {
      borderRadius: { lg: "var(--radius)", md: "var(--radius)", sm: "var(--radius)" },
    },
  },
};`;

    beforeEach(async () => {
      await writeJson(join(tmp, "theme/default.json"), {
        ...sampleTheme,
        radius: SCAFFOLD_RADIUS,
      });
      folder = await loadDesignFolder(tmp);
      ctx = { folder, broadcast: (e) => events.push(e) };
    });

    test("a base --radius replaces the scale, so no step keeps the old rounding", async () => {
      const r = unwrap(await importThemeCss(ctx, SQUARE_APP_CSS, { apply: true }));
      expect(r.theme.radius).toEqual({ md: "0rem", full: 9999 });
      expect((await diskTheme()).radius).toEqual({ md: "0rem", full: 9999 });

      // The reported bug: `--radius-lg: 8px` beside `--radius: 0rem`.
      const css = themeToCss(r.theme);
      expect(css).toContain("--radius: 0rem;");
      expect(css).toContain("--radius-lg: var(--radius);");
      expect(css).not.toMatch(/--radius-(sm|md|lg|xl): \d/);
    });

    test("the dry run reports the steps it would drop, and drops nothing", async () => {
      const r = unwrap(await importThemeCss(ctx, SQUARE_APP_CSS));
      expect(r.changes.filter((c) => c.token.startsWith("radius."))).toEqual([
        { token: "radius.md", from: "6", to: "0rem" },
        { token: "radius.sm", from: "4", to: null },
        { token: "radius.lg", from: "8", to: null },
        { token: "radius.xl", from: "12", to: null },
      ]);
      expect((await diskTheme()).radius).toEqual(SCAFFOLD_RADIUS);
    });

    test("a v3 config mapping every step to var(--radius) lands on the same base", async () => {
      const r = unwrap(
        await importThemeCss(ctx, SQUARE_APP_CSS, { apply: true, tailwindConfig: FLAT_V3_CONFIG }),
      );
      expect(r.theme.radius).toEqual({ md: "0rem", full: 9999 });
    });

    test("a second import of the same sheet reports no radius change", async () => {
      unwrap(await importThemeCss(ctx, SQUARE_APP_CSS, { apply: true }));
      const again = unwrap(await importThemeCss(ctx, SQUARE_APP_CSS));
      expect(again.changes.filter((c) => c.token.startsWith("radius."))).toEqual([]);
    });

    test("explicit steps with no base are laid on the scale, which stays", async () => {
      const r = unwrap(await importThemeCss(ctx, "@theme { --radius-lg: 1rem; }", { apply: true }));
      expect(r.theme.radius).toEqual({ ...SCAFFOLD_RADIUS, lg: "1rem" });
      expect(r.changes).toEqual([{ token: "radius.lg", from: "8", to: "1rem" }]);
    });
  });

  test("undeclared slots keep their current values", async () => {
    const r = unwrap(
      await importThemeCss(ctx, `:root { --background: #fafafa; }`, { apply: true }),
    );
    expect(r.changes).toEqual([
      { token: "colors.background", from: "oklch(1 0 0)", to: "#fafafa" },
    ]);
    const onDisk = await diskTheme();
    expect(onDisk.colors.foreground).toBe("oklch(0.145 0 0)");
    expect(onDisk.colors.primary).toEqual({
      DEFAULT: "oklch(0.205 0 0)",
      foreground: "oklch(0.985 0 0)",
    });
  });

  test("a slot stated without its foreground keeps the foreground it had", async () => {
    unwrap(await importThemeCss(ctx, `:root { --primary: #2f7d4f; }`, { apply: true }));
    expect((await diskTheme()).colors.primary).toEqual({
      DEFAULT: "#2f7d4f",
      foreground: "oklch(0.985 0 0)",
    });
  });

  test("ingests tailwind.config theme.extend into palette / spacing / shadows / font roles", async () => {
    const r = unwrap(
      await importThemeCss(ctx, HOST_APP_CSS, { apply: true, tailwindConfig: HOST_TW_CONFIG }),
    );
    const onDisk = await diskTheme();
    expect(onDisk.palette?.paprika).toBe("#E2571E");
    expect(onDisk.palette?.teal).toBe("#0FA3A3");
    expect(onDisk.palette?.["brand-500"]).toBe("#123456");
    expect(onDisk.spacing?.["icon-rail"]).toBe("3rem");
    expect(onDisk.spacing?.header).toBe("4rem");
    expect(onDisk.shadows?.card).toBe("0 2px 8px rgba(0,0,0,0.06)");
    expect(onDisk.shadows?.lift).toBe("0 12px 32px rgba(0,0,0,0.12)");
    expect(onDisk.typography.fontFamily?.display).toBe("Fraunces, serif");
    // Container is applied as a real theme concept (not just reported).
    expect(onDisk.container).toEqual({ center: true, padding: "1.5rem", maxWidth: "1320px" });
    const tokens = r.changes.map((c) => c.token);
    expect(tokens).toContain("palette.paprika");
    expect(tokens).toContain("spacing.icon-rail");
    expect(tokens).toContain("shadows.card");
    expect(tokens).toContain("typography.fontFamily.display");
    expect(tokens).toContain("container.padding");
  });

  test("ingests keyframes + animation shorthands from tailwind.config", async () => {
    const cfg = `export default { theme: { extend: {
      keyframes: { fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } } },
      animation: { "fade-in": "fadeIn 0.3s ease-out" },
    } } };`;
    const r = unwrap(await importThemeCss(ctx, HOST_APP_CSS, { apply: true, tailwindConfig: cfg }));
    const onDisk = await diskTheme();
    expect(onDisk.keyframes?.fadeIn).toEqual({ "0%": { opacity: "0" }, "100%": { opacity: "1" } });
    expect(onDisk.animation?.["fade-in"]).toBe("fadeIn 0.3s ease-out");
    const tokens = r.changes.map((c) => c.token);
    expect(tokens).toContain("keyframes.fadeIn");
    expect(tokens).toContain("animation.fade-in");
  });

  test("a CSS-derived palette value wins over the same name in tailwind.config", async () => {
    const css = `${HOST_APP_CSS}\n:root { --teal: #00e5e5; }`;
    unwrap(await importThemeCss(ctx, css, { apply: true, tailwindConfig: HOST_TW_CONFIG }));
    const onDisk = await diskTheme();
    // The stylesheet's resolved --teal wins; the config literal does not clobber it.
    expect(onDisk.palette?.teal).toBe("#00e5e5");
    // Names only in the config still come through.
    expect(onDisk.palette?.paprika).toBe("#E2571E");
  });

  test("unchanged tokens don't report as changes", async () => {
    const css = `:root { --background: oklch(1 0 0); --primary: #123456; }`;
    const r = unwrap(await importThemeCss(ctx, css));
    const tokens = r.changes.map((c) => c.token);
    expect(tokens).not.toContain("colors.background");
    expect(tokens).toContain("colors.primary.DEFAULT");
  });

  test("CSS with no recognizable tokens is an empty answer, and persists nothing even when applied", async () => {
    const before = JSON.stringify(ctx.folder.theme);
    const r = unwrap(await importThemeCss(ctx, `body { margin: 0; }`, { apply: true }));
    expect(r.tokenless).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.changes).toEqual([]);
    expect(r.coverage.semantic).toBe(0);
    expect(JSON.stringify(r.theme)).toBe(before);
    expect(JSON.stringify(ctx.folder.theme)).toBe(before);
  });

  test("a stylesheet with tokens is not tokenless", async () => {
    expect(unwrap(await importThemeCss(ctx, HOST_APP_CSS)).tokenless).toBe(false);
  });

  test("numeric scales + extra roles merge into palette and persist", async () => {
    const css = `:root {
  --primary-600: #4f46e5;
  --success-500: #22c55e;
  --danger: #ef4444;
}
.dark { --primary-600: #818cf8; }`;
    const r = unwrap(await importThemeCss(ctx, css, { apply: true }));
    expect(r.applied).toBe(true);
    const tokens = r.changes.map((c) => c.token);
    expect(tokens).toContain("palette.primary-600");
    expect(tokens).toContain("palette.success-500");
    expect(tokens).toContain("paletteDark.primary-600");

    const onDisk = await diskTheme();
    expect(onDisk.palette).toEqual({
      "primary-600": "#4f46e5",
      "success-500": "#22c55e",
      danger: "#ef4444",
    });
    expect(onDisk.paletteDark).toEqual({ "primary-600": "#818cf8" });
  });

  test("a palette-only stylesheet imports (foundAny includes palette)", async () => {
    const r = await importThemeCss(ctx, `:root { --brand-700: #0ea5e9; }`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.changes.map((c) => c.token)).toContain("palette.brand-700");
  });

  test("a config color colliding with a semantic slot does NOT become a palette passthrough", async () => {
    const cfg = `export default { theme: { extend: { colors: {
      "primary-foreground": "hsl(var(--primary-foreground))",
      destructive: "#dc2626",
      brand: "#0ea5e9",
    } } } };`;
    const r = unwrap(await importThemeCss(ctx, HOST_APP_CSS, { apply: true, tailwindConfig: cfg }));
    const onDisk = await diskTheme();
    // The collisions are filtered — they'd otherwise shadow the semantic slots
    // extractColors owns with an unrelated (var-ref) value.
    expect(onDisk.palette?.["primary-foreground"]).toBeUndefined();
    expect(onDisk.palette?.destructive).toBeUndefined();
    // A non-colliding brand name still lands.
    expect(onDisk.palette?.brand).toBe("#0ea5e9");
    expect(r.changes.map((c) => c.token)).not.toContain("palette.primary-foreground");
    expect(r.changes.map((c) => c.token)).toContain("palette.brand");
  });

  test("a config color value referencing a stylesheet var resolves to the concrete value", async () => {
    // --accent-warm is declared in the imported stylesheet; the config names a
    // palette color whose value points at it via var(). It must flatten.
    const css = `:root { --accent-warm: 24 100% 50%; }`;
    const cfg = `export default { theme: { extend: { colors: {
      "accent-warm": "hsl(var(--accent-warm))",
      ghost: "hsl(var(--does-not-exist))",
    } } } };`;
    const r = unwrap(await importThemeCss(ctx, css, { apply: true, tailwindConfig: cfg }));
    const onDisk = await diskTheme();
    expect(onDisk.palette?.["accent-warm"]).toBe("hsl(24 100% 50%)");
    // A ref that resolves to nothing is dropped (not persisted dangling) + warned.
    expect(onDisk.palette?.ghost).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  test("reports semantic coverage alongside the raw change count", async () => {
    const r = unwrap(await importThemeCss(ctx, HOST_APP_CSS));
    expect(r.coverage.semantic).toBeGreaterThan(0);
    expect(r.coverage.semanticTotal).toBe(12);
    expect(r.coverage.unmapped).toContain("popover");
    expect(r.coverage.unmapped).not.toContain("background");
  });

  test("an app on its own naming convention maps zero slots, and says so", async () => {
    // Bing's vars, in shape: plenty of them, none matching shadcn's names. The
    // merge succeeds and reports hundreds of changes, so without this the
    // caller has no signal that the design will still render on the old palette.
    const css = `:root {
      --smtc-background-web-page-primary: #ffffff;
      --smtc-stroke-web-divider: #e5e5e5;
      --smtc-fill-web-accent-rest: #174ae4;
    }`;
    const r = unwrap(await importThemeCss(ctx, css));
    expect(r.changes.length).toBeGreaterThan(0);
    expect(r.coverage.semantic).toBe(0);
    expect(r.coverage.palette).toBe(3);
    expect(r.coverage.unmapped).toHaveLength(12);
    expect(r.warnings.some((w) => w.includes("semantic color slots"))).toBe(true);

    // The scaffold's palette is untouched — which is exactly the danger.
    const theme = r.theme;
    expect(theme.colors.background).toBe(sampleTheme.colors.background);
  });

  test("a slot the stylesheet names but does not change still counts as mapped", async () => {
    const primary = sampleTheme.colors.primary;
    const css = `:root { --primary: ${typeof primary === "string" ? primary : primary.DEFAULT}; }`;
    const r = unwrap(await importThemeCss(ctx, css));
    expect(r.coverage.semantic).toBe(1);
    expect(r.coverage.unmapped).not.toContain("primary");
  });
});

/**
 * An app in the shadcn + Tailwind 3 + next/font shape: the slots are pairs in
 * the config, the fonts are variables a loader sets at runtime, and half of
 * what makes it look like itself is in `theme.extend`.
 */
const NEXT_FONT_CONFIG = `
export default {
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        acid: "hsl(var(--acid))",
      },
      fontFamily: {
        display: ["var(--font-display)", "Impact", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { lg: "var(--radius)", md: "var(--radius)" },
      borderWidth: { DEFAULT: "2px", 3: "3px" },
      letterSpacing: { machine: "0.22em" },
    },
  },
};
`;
const LIGHT_ONLY_CSS = `
:root {
  --background: 46 24% 92%;
  --primary: 64 92% 52%;
  --primary-foreground: 220 18% 11%;
  --acid: 64 92% 52%;
  --radius: 0rem;
}
`;

describe("importThemeCss — what it leaves behind", () => {
  test("names the fonts, the config namespaces and the dark palette it did not carry", async () => {
    const r = unwrap(
      await importThemeCss(ctx, LIGHT_ONLY_CSS, { tailwindConfig: NEXT_FONT_CONFIG }),
    );
    expect(r.notImported.map((entry) => entry.what)).toEqual([
      "tailwind.config fontFamily.display",
      "tailwind.config fontFamily.sans",
      "tailwind.config theme.extend.borderWidth (DEFAULT, 3)",
      "tailwind.config theme.extend.letterSpacing (machine)",
      "a dark palette",
    ]);
    // With nobody to ask where the variable is set, a font says which one it waits on.
    expect(r.notImported[0]?.reason).toContain("--font-display");
    expect(r.fonts).toEqual([]);
    // The theme is not left pointing at a variable nothing sets.
    expect(r.theme.typography.fontFamily?.display).toBe(sampleTheme.typography.fontFamily?.display);
  });

  test("a font a loader sets at runtime is imported from the loader call, family and weights", async () => {
    const loaders: Record<string, { file: string; family?: string; google?: string }> = {
      "--font-display": { file: "app/layout.tsx", family: "Archivo Black", google: "wght@400" },
      // A variable face: the loader states no weights, the catalogue knows its range.
      "--font-sans": { file: "app/layout.tsx", family: "Space Grotesk" },
    };
    const r = unwrap(
      await importThemeCss(ctx, LIGHT_ONLY_CSS, {
        apply: true,
        tailwindConfig: NEXT_FONT_CONFIG,
        fontLoader: (cssVar) => loaders[cssVar] ?? null,
      }),
    );
    expect(r.fonts).toEqual([
      { role: "display", family: "Archivo Black", from: "app/layout.tsx" },
      { role: "sans", family: "Space Grotesk", from: "app/layout.tsx" },
    ]);
    const { typography } = await diskTheme();
    expect(typography.fontFamily?.display).toStartWith('"Archivo Black", ');
    expect(typography.fontFamily?.sans).toStartWith('"Space Grotesk", ');
    // Loaded, at the app's weights — and the config's literal `mono` is too.
    expect(typography.googleFonts).toEqual([
      "Archivo+Black:wght@400",
      "Space+Grotesk:wght@300..700",
      expect.stringMatching(/^IBM\+Plex\+Mono:/),
    ]);
    expect(r.changes.map((c) => c.token)).toContain("typography.fontFamily.display");
    expect(r.notImported.map((entry) => entry.what)).not.toContain(
      "tailwind.config fontFamily.display",
    );
  });

  test("a font file the app loads locally is named as one, with no family to import", async () => {
    const r = unwrap(
      await importThemeCss(ctx, LIGHT_ONLY_CSS, {
        tailwindConfig: NEXT_FONT_CONFIG,
        fontLoader: (cssVar) => (cssVar === "--font-display" ? { file: "app/fonts.ts" } : null),
      }),
    );
    const display = r.notImported.find((e) => e.what === "tailwind.config fontFamily.display");
    expect(display?.reason).toContain("next/font/local in app/fonts.ts");
    expect(r.fonts).toEqual([]);
  });

  test("a family the stylesheet names is loaded, and the starter's faces no role uses are not", async () => {
    await writeJson(join(tmp, "theme/default.json"), {
      ...sampleTheme,
      typography: {
        fontFamily: { sans: '"DM Sans", Arial, sans-serif' },
        googleFonts: ["DM+Sans:wght@400;500;600;700", "DM+Serif+Display"],
      },
    });
    ctx = { folder: await loadDesignFolder(tmp), broadcast: (e) => events.push(e) };
    const css = `${HOST_APP_CSS}\n:root { --font-inter: 'Inter', sans-serif; }`;
    const r = unwrap(await importThemeCss(ctx, css));
    expect(r.theme.typography.googleFonts).toEqual([
      "DM+Sans:wght@400;500;600;700",
      expect.stringMatching(/^Inter:/),
    ]);
  });

  test("a font stack the config spells out replaces the one the theme started with", async () => {
    // A fresh design's starter theme already has a `mono`; that used to be
    // reason enough to skip the app's.
    await writeJson(join(tmp, "theme/default.json"), {
      ...sampleTheme,
      typography: { fontFamily: { mono: "ui-monospace, monospace" } },
    });
    ctx = { folder: await loadDesignFolder(tmp), broadcast: (e) => events.push(e) };
    const r = unwrap(
      await importThemeCss(ctx, LIGHT_ONLY_CSS, { tailwindConfig: NEXT_FONT_CONFIG }),
    );
    expect(r.theme.typography.fontFamily?.mono).toBe("IBM Plex Mono, ui-monospace, monospace");
    expect(r.changes.map((c) => c.token)).toContain("typography.fontFamily.mono");
  });

  test("a slot written as a pair in the config is not copied into the palette", async () => {
    const r = unwrap(
      await importThemeCss(ctx, LIGHT_ONLY_CSS, { tailwindConfig: NEXT_FONT_CONFIG }),
    );
    expect(Object.keys(r.theme.palette ?? {})).toEqual(["acid"]);
  });

  test("the dark palette is named as not the app's when the stylesheet has none", async () => {
    const r = unwrap(await importThemeCss(ctx, LIGHT_ONLY_CSS));
    const dark = r.notImported.find((entry) => entry.what === "a dark palette");
    expect(dark?.reason).toContain(
      Object.keys(sampleTheme.colorsDark ?? {}).length > 0 ? "not the app's" : "no dark palette",
    );
  });

  test("an app that names its faces but no `sans` is told its body font is still the theme's", async () => {
    const css = `${HOST_APP_CSS}\n:root { --font-inter: 'Inter', sans-serif; --font-manrope: 'Manrope', sans-serif; }`;
    const r = unwrap(await importThemeCss(ctx, css));
    const body = r.notImported.find((entry) => entry.what === "a body font (`sans`)");
    expect(body?.reason).toContain("`inter`, `manrope`");
    // Once one of them is the body face, there is nothing to say.
    unwrap(await importThemeCss(ctx, `${css}\n:root { --font-sans: 'Inter', sans-serif; }`));
    await writeJson(join(tmp, "theme/default.json"), {
      ...sampleTheme,
      typography: { fontFamily: { sans: '"Inter", ui-sans-serif, sans-serif' } },
    });
    ctx = { folder: await loadDesignFolder(tmp), broadcast: (e) => events.push(e) };
    expect(unwrap(await importThemeCss(ctx, css)).notImported).toEqual([]);
  });

  test("a stylesheet that states everything it uses leaves nothing behind", async () => {
    const r = unwrap(await importThemeCss(ctx, HOST_APP_CSS));
    expect(r.notImported).toEqual([]);
  });
});
