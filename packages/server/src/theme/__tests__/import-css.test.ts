import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { importThemeCss, type ThemeContext } from "../index.ts";

const sampleConfig = {
  schemaVersion: 2,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "components/ui",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
};
const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};
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
    expect(tokens).toContain("colors.primary");
  });

  test("CSS with no recognizable tokens errors", async () => {
    const r = await importThemeCss(ctx, `body { margin: 0; }`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("BadRequest");
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
});
