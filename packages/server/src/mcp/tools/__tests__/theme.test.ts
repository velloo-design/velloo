import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Theme } from "@velloo/schema";
import { designTheme, testContext } from "../../../testing/design-folder.ts";
import type { ThemeContext } from "../../../theme/index.ts";
import type { McpResult } from "../result.ts";
import { registerThemeTools } from "../theme.ts";

/**
 * The MCP theme surface. The operations underneath have their own suites; what
 * was untested is the tool layer an agent actually talks to — argument
 * validation, the order channels apply in, how a stylesheet path is resolved
 * against a host app that lives outside the design folder, and the guidance
 * that rides back on an import.
 */

let folder: Awaited<ReturnType<typeof testContext>>;
let ctx: ThemeContext;
let hostRoot: string;

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

async function call(name: string, args: Record<string, unknown> = {}): Promise<McpResult> {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerThemeTools(mcp, ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.handler(args, {});
}

const body = (r: McpResult): Record<string, unknown> =>
  JSON.parse(r.content[0]?.type === "text" ? r.content[0].text : "{}");

const ok = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(body(r))}`);
  return body(r);
};

const fails = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args);
  expect(r.isError).toBe(true);
  return body(r) as { kind: string; message?: string };
};

const liveTheme = (name = "default"): Theme =>
  (name === "default" ? folder.ctx.folder.theme : folder.ctx.folder.themes.get(name)) as Theme;

const GLOBALS_CSS = `
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.55 0.2 264);
  --primary-foreground: oklch(0.985 0 0);
  --brand-ink: #123456;
  --radius: 0.75rem;
  --font-sans: "Inter", ui-sans-serif, sans-serif;
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
}
`;

const TW_CONFIG = `
export default {
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: { colors: { brand: "#ff0055" } },
  },
};
`;

beforeEach(async () => {
  hostRoot = await mkdtemp(join(tmpdir(), "velloo-theme-host-"));
  folder = await testContext({
    label: "mcp-theme",
    config: { hostApp: { root: hostRoot } },
    theme: designTheme(),
  });
  ctx = folder.ctx;
});

afterEach(async () => {
  await folder.cleanup();
  await rm(hostRoot, { recursive: true, force: true });
});

describe("set_theme — the one verb", () => {
  test("refuses a call that patches nothing, naming every channel", async () => {
    const error = await fails("set_theme");
    expect(error.kind).toBe("BadRequest");
    for (const channel of ["from", "tokens", "fonts", "typeset", "customCss"]) {
      expect(error.message).toContain(channel);
    }
  });

  test("patches tokens and echoes what landed", async () => {
    const result = await ok("set_theme", { tokens: { "colors.primary.DEFAULT": "#4f46e5" } });
    expect(result.theme).toBe("default");
    expect((result.applied as { tokens: string[] }).tokens).toEqual(["colors.primary.DEFAULT"]);
    expect(liveTheme().colors.primary).toMatchObject({ DEFAULT: "#4f46e5" });
  });

  test("`from` reseeds before the token patch, so the patch wins", async () => {
    // Order is the whole contract here: reseeding after the patch would
    // silently throw the agent's explicit colour away.
    const result = await ok("set_theme", {
      from: { preset: "violet" },
      tokens: { "colors.primary.DEFAULT": "#00ff00" },
    });
    expect(result.applied).toMatchObject({ from: { preset: "violet" } });
    expect(liveTheme().colors.primary).toMatchObject({ DEFAULT: "#00ff00" });
  });

  test("a seed colour derives a palette", async () => {
    await ok("set_theme", { from: { seedColor: "#3366ff" } });
    expect(liveTheme().colors.primary).toBeDefined();
  });

  test("a seed colour that isn't a colour is refused", async () => {
    await fails("set_theme", { from: { seedColor: "not-a-colour" } });
  });

  test("declares font roles and names them back", async () => {
    const result = await ok("set_theme", {
      fonts: [{ role: "display", family: "Unbounded", google: true }],
    });
    expect((result.applied as { fonts: string[] }).fonts).toEqual(["display"]);
    expect(liveTheme().typography.fontFamily?.display).toContain("Unbounded");
  });

  test("sets the type rhythm, defaulting the typeset name", async () => {
    const result = await ok("set_theme", { typeset: [{ leading: 1.6 }] });
    expect((result.applied as { typeset: string[] }).typeset).toEqual(["default"]);
  });

  test("replaces custom.css and reports its size", async () => {
    const css = ".promo { letter-spacing: -0.02em; }";
    const result = await ok("set_theme", { customCss: css });
    expect((result.applied as { customCss: { bytes: number } }).customCss.bytes).toBe(css.length);
    expect(await Bun.file(join(folder.root, "theme/custom.css")).text()).toBe(css);
  });

  test("warns when a palette token shadows a semantic slot", async () => {
    // It would emit a duplicate `--color-primary` that the semantic slot wins,
    // so the token silently does nothing — worth saying at the source.
    const result = await ok("set_theme", { tokens: { "palette.primary": "#ff0000" } });
    const warnings = (result.applied as { warnings?: string[] }).warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("palette.primary");
    expect(warnings[0]).toContain("colors.primary");
  });

  test("a palette token that shadows nothing passes without comment", async () => {
    const result = await ok("set_theme", { tokens: { "palette.brand-ink": "#123456" } });
    expect(result.applied).not.toHaveProperty("warnings");
  });

  test("a token written the way CSS names it lands in the nested slot, and the answer says which path was used", async () => {
    // `--primary-foreground` is how every stylesheet spells it, so it is the
    // first thing an agent writes; a refusal here cost a round trip each time.
    const result = await ok("set_theme", { tokens: { "colors.primary-foreground": "#fafafa" } });
    expect(result.applied).toMatchObject({
      tokens: ["colors.primary.foreground"],
      readAs: { "colors.primary-foreground": "colors.primary.foreground" },
    });
    expect(liveTheme().colors.primary).toMatchObject({ foreground: "#fafafa" });
    // A path already in the theme's own shape is not reported as a reading.
    const exact = await ok("set_theme", { tokens: { "colors.primary.foreground": "#ffffff" } });
    expect(exact.applied).not.toHaveProperty("readAs");
  });

  test("a token path the theme doesn't have is refused", async () => {
    await fails("set_theme", { tokens: { "colors.primry.DEFAULT": "#fff" } });
  });

  test("edits a named theme when asked", async () => {
    await ok("add_theme", { name: "midnight" });
    await ok("set_theme", { theme: "midnight", tokens: { "colors.background": "#000000" } });
    expect(liveTheme("midnight").colors.background).toBe("#000000");
    expect(liveTheme().colors.background).not.toBe("#000000");
  });
});

describe("the named-theme lifecycle", () => {
  test("add, list, rename and remove round-trip through the tools", async () => {
    await ok("add_theme", { name: "midnight" });
    const listed = (await ok("list_themes")) as { themes: { name: string }[] };
    expect(listed.themes.map((t) => t.name).sort()).toEqual(["default", "midnight"]);

    await ok("update_theme", { name: "midnight", renameTo: "after-dark" });
    await ok("remove_theme", { name: "after-dark" });
    const after = (await ok("list_themes")) as { themes: { name: string }[] };
    expect(after.themes.map((t) => t.name)).toEqual(["default"]);
  });

  test("the default theme can't be removed", async () => {
    await fails("remove_theme", { name: "default" });
  });

  test("adding a name that already exists needs overwrite", async () => {
    await ok("add_theme", { name: "midnight" });
    await fails("add_theme", { name: "midnight" });
    await ok("add_theme", { name: "midnight", overwrite: true });
  });
});

describe("import_theme — finding the stylesheet", () => {
  test("refuses when given neither css nor a path", async () => {
    const error = await fails("import_theme");
    expect(error.message).toContain("either");
  });

  test("treats blank css text as absent rather than as an empty stylesheet", async () => {
    const error = await fails("import_theme", { css: "   " });
    expect(error.message).toContain("either");
  });

  test("reads a path relative to the host app root", async () => {
    await writeFile(join(hostRoot, "globals.css"), GLOBALS_CSS);
    const result = await ok("import_theme", { cssPath: "globals.css" });
    expect(result.changeCount).toBeGreaterThan(0);
  });

  test("reads an absolute path", async () => {
    const abs = join(hostRoot, "styles.css");
    await writeFile(abs, GLOBALS_CSS);
    expect((await ok("import_theme", { cssPath: abs })).changeCount).toBeGreaterThan(0);
  });

  test("falls back to the design folder itself", async () => {
    await folder.write("globals.css", GLOBALS_CSS);
    expect((await ok("import_theme", { cssPath: "globals.css" })).changeCount).toBeGreaterThan(0);
  });

  test("a path that resolves nowhere lists what it tried, and says where to look", async () => {
    const error = await fails("import_theme", { cssPath: "nope/globals.css" });
    expect(error.message).toContain("nope/globals.css");
    expect(error.message).toContain(hostRoot);
    expect(error.message).toContain("OUTSIDE the design folder");
  });
});

describe("import_theme — what it did not import", () => {
  const CSS = ":root { --background: #f4f1e8; --primary: #d9e021; }\n";
  const CONFIG = `export default { theme: { extend: {
    fontFamily: {
      display: ["var(--font-display)", "Impact", "sans-serif"],
      brand: ["var(--font-brand)", "serif"],
      sans: ["var(--font-sans)", "sans-serif"],
    },
    borderWidth: { DEFAULT: "2px" },
  } } };`;

  beforeEach(async () => {
    await mkdir(join(hostRoot, "app"), { recursive: true });
    await writeFile(join(hostRoot, "app", "globals.css"), CSS);
    await writeFile(join(hostRoot, "tailwind.config.ts"), CONFIG);
    await writeFile(
      join(hostRoot, "app", "layout.tsx"),
      `import { Archivo_Black, Space_Grotesk } from "next/font/google";
       import localFont from "next/font/local";
       const display = Archivo_Black({ weight: "400", variable: "--font-display" });
       const brand = localFont({ src: "./Brand.woff2", variable: "--font-brand" });
       const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });`,
    );
  });

  type Left = { what: string; reason: string };

  test("a font a loader sets at runtime is imported from the app's layout", async () => {
    const result = await ok("import_theme", { cssPath: "app/globals.css", apply: true });
    expect(result.fonts).toEqual([
      { role: "display", family: "Archivo Black", from: "app/layout.tsx" },
      { role: "sans", family: "Space Grotesk", from: "app/layout.tsx" },
    ]);
    const { fontFamily, googleFonts } = liveTheme().typography;
    expect(fontFamily?.display).toStartWith('"Archivo Black", ');
    // At the weights the app loads; a variable face by its range, since a
    // bare load is one weight of it.
    expect(googleFonts).toContain("Archivo+Black:wght@400");
    expect(googleFonts).toContain("Space+Grotesk:wght@300..700");
    // A local file has no family to name; it says so instead of guessing one.
    const left = result.notImported as Left[];
    const brand = left.find((entry) => entry.what === "tailwind.config fontFamily.brand");
    expect(brand?.reason).toContain("next/font/local in app/layout.tsx");
  });

  test("lists what it could not carry: the local font, a config namespace, the dark palette", async () => {
    const result = await ok("import_theme", { cssPath: "app/globals.css" });
    expect((result.notImported as Left[]).map((entry) => entry.what)).toEqual([
      "tailwind.config fontFamily.brand",
      "tailwind.config theme.extend.borderWidth (DEFAULT)",
      "a dark palette",
    ]);
  });
});

describe("import_theme — a design that is not bound to an app", () => {
  test("takes the stylesheet's own package as the app, so a font its layout loads is still found", async () => {
    // No `hostApp` in the config: the only thing that says which app this is
    // is the absolute path the stylesheet was given by.
    const unbound = await testContext({ label: "mcp-theme-unbound", theme: designTheme() });
    ctx = unbound.ctx;
    try {
      await mkdir(join(hostRoot, "src", "app"), { recursive: true });
      await writeFile(join(hostRoot, "package.json"), JSON.stringify({ name: "web" }));
      await writeFile(
        join(hostRoot, "src", "app", "globals.css"),
        ":root { --background: #f4f1e8; --font-sans: var(--font-grotesk), sans-serif; }\n",
      );
      await writeFile(
        join(hostRoot, "tailwind.config.ts"),
        'export default { theme: { extend: { fontFamily: { sans: ["var(--font-grotesk)", "sans-serif"] } } } };',
      );
      await writeFile(
        join(hostRoot, "src", "app", "layout.tsx"),
        `import { Space_Grotesk } from "next/font/google";
         const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });`,
      );
      const result = await ok("import_theme", {
        cssPath: join(hostRoot, "src", "app", "globals.css"),
        tailwindConfigPath: join(hostRoot, "tailwind.config.ts"),
      });
      expect(result.fonts).toEqual([
        { role: "sans", family: "Space Grotesk", from: "src/app/layout.tsx" },
      ]);
    } finally {
      await unbound.cleanup();
    }
  });
});

describe("set_theme — fonts from Google", () => {
  test("`google: true` on a family the catalogue knows loads its weights, not regular alone", async () => {
    await ok("set_theme", { fonts: [{ role: "sans", family: "Space Grotesk", google: true }] });
    expect(liveTheme().typography.googleFonts).toContain("Space+Grotesk:wght@300..700");
  });

  test("on a family it does not know, it loads regular and says that is all", async () => {
    const result = await ok("set_theme", {
      fonts: [{ role: "display", family: "Zzz Made Up Grotesk", google: true }],
    });
    expect(liveTheme().typography.googleFonts).toContain("Zzz+Made+Up+Grotesk");
    expect((result.applied as { fontsRegularOnly?: string }).fontsRegularOnly).toContain(
      "regular weight only",
    );
  });

  test("a family nothing loads is said to be unloaded; a system face and a loaded one are not", async () => {
    const result = await ok("set_theme", {
      fonts: [
        { role: "display", family: "Brandon Grotesque" },
        { role: "serif", family: "Georgia" },
        { role: "sans", family: "Space Grotesk", google: true },
      ],
    });
    const note = (result.applied as { fontsNotLoaded?: string }).fontsNotLoaded ?? "";
    expect(note).toContain('Nothing loads "Brandon Grotesque"');
    expect(note).toContain("customCss");
    expect(note).not.toContain("Georgia");
    expect(note).not.toContain("Space Grotesk");

    const quiet = await ok("set_theme", { fonts: [{ role: "serif", family: "Georgia" }] });
    expect(quiet.applied).not.toHaveProperty("fontsNotLoaded");
  });

  test("an axis spec is taken as given", async () => {
    const result = await ok("set_theme", {
      fonts: [{ role: "sans", family: "Space Grotesk", google: "wght@500" }],
    });
    expect(liveTheme().typography.googleFonts).toContain("Space+Grotesk:wght@500");
    expect(result.applied).not.toHaveProperty("fontsRegularOnly");
  });
});

describe("import_theme — a stylesheet that imports its tokens", () => {
  const ENTRY_CSS = "@import 'tailwindcss';\n@import 'tw-animate-css';\n@import './theme.css';\n";

  beforeEach(async () => {
    await mkdir(join(hostRoot, "src", "styles"), { recursive: true });
    await writeFile(join(hostRoot, "src", "styles", "index.css"), ENTRY_CSS);
  });

  test("reads the tokens from the sheet the entry imports, and names it", async () => {
    await writeFile(join(hostRoot, "src", "styles", "theme.css"), GLOBALS_CSS);
    const result = await ok("import_theme", { cssPath: "src/styles/index.css", apply: true });
    expect(result.importedStylesheets).toEqual([
      join(hostRoot, "src", "styles", "index.css"),
      join(hostRoot, "src", "styles", "theme.css"),
    ]);
    expect(liveTheme().colors.primary).toMatchObject({ DEFAULT: "oklch(0.55 0.2 264)" });
    expect(liveTheme().colorsDark?.background).toBe("oklch(0.145 0 0)");
    expect(liveTheme().radius.md).toBe("0.75rem");
  });

  test("a single-file stylesheet reports no imported stylesheets", async () => {
    await writeFile(join(hostRoot, "globals.css"), GLOBALS_CSS);
    const result = await ok("import_theme", { cssPath: "globals.css" });
    expect(result).not.toHaveProperty("importedStylesheets");
  });

  test("an import that leaves the app is not read, and the refusal names it", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "velloo-theme-elsewhere-"));
    try {
      await writeFile(join(elsewhere, "theme.css"), GLOBALS_CSS);
      const specifier = `../../../${basename(elsewhere)}/theme.css`;
      await writeFile(
        join(hostRoot, "src", "styles", "index.css"),
        `@import 'tailwindcss';\n@import '${specifier}';\n`,
      );
      const error = await fails("import_theme", { cssPath: "src/styles/index.css" });
      expect(error.message).toContain("no theme tokens");
      expect(error.message).toContain(specifier);
      expect(error.message).toContain("outside the app root");
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  test("a skipped import rides back as a warning when the rest imported", async () => {
    await writeFile(
      join(hostRoot, "src", "styles", "index.css"),
      `@import './gone.css';\n${GLOBALS_CSS}`,
    );
    const result = await ok("import_theme", { cssPath: "src/styles/index.css" });
    expect((result.warnings as string[]).join("\n")).toContain("./gone.css");
  });

  test("pasted css has no location, so its imports are left alone", async () => {
    await writeFile(join(hostRoot, "src", "styles", "theme.css"), GLOBALS_CSS);
    const error = await fails("import_theme", { css: ENTRY_CSS });
    expect(error.message).toContain("no theme tokens");
  });
});

describe("import_theme — what comes back", () => {
  beforeEach(async () => {
    await writeFile(join(hostRoot, "globals.css"), GLOBALS_CSS);
  });

  test("is a dry run unless asked to persist", async () => {
    const before = liveTheme().colors.primary;
    const result = await ok("import_theme", { cssPath: "globals.css" });
    expect(result.applied).toBe(false);
    expect(result.note).toContain("dry-run");
    expect(liveTheme().colors.primary).toEqual(before);
  });

  test("apply persists the merge", async () => {
    const result = await ok("import_theme", { cssPath: "globals.css", apply: true });
    expect(result.applied).toBe(true);
    expect(result).not.toHaveProperty("note");
    expect(liveTheme().colors.primary).toMatchObject({ DEFAULT: "oklch(0.55 0.2 264)" });
  });

  test("picks up the tailwind config beside the stylesheet and reports its container", async () => {
    await writeFile(join(hostRoot, "tailwind.config.ts"), TW_CONFIG);
    const result = await ok("import_theme", { cssPath: "globals.css" });
    const container = result.container as { suggestedClasses: string; note: string };
    expect(container.suggestedClasses).toContain("mx-auto");
    expect(container.note).toContain("container");
  });

  test("takes an explicit tailwind config path", async () => {
    await writeFile(join(hostRoot, "custom-tw.ts"), TW_CONFIG);
    const result = await ok("import_theme", {
      cssPath: "globals.css",
      tailwindConfigPath: join(hostRoot, "custom-tw.ts"),
    });
    expect(result).toHaveProperty("container");
  });

  test("no tailwind config means no container guidance, not a failure", async () => {
    const result = await ok("import_theme", { cssPath: "globals.css" });
    expect(result).not.toHaveProperty("container");
  });

  test("flags a client chart library so the agent registers the app's own charts", async () => {
    await writeFile(
      join(hostRoot, "package.json"),
      JSON.stringify({ name: "app", dependencies: { recharts: "^2.0.0" } }),
    );
    const result = await ok("import_theme", { cssPath: "globals.css" });
    expect(result.detectedChartLibs).toEqual(["recharts"]);
    expect(result.chartHint).toContain('render:"live"');
  });

  test("a chart library the app installs and never draws with gets no hint", async () => {
    await writeFile(
      join(hostRoot, "package.json"),
      JSON.stringify({ name: "app", dependencies: { recharts: "^2.0.0" } }),
    );
    const entry = (name: string, packageName?: string) => ({
      name,
      source: packageName ? "package" : "local",
      packageName,
    });
    const withCatalog = (entries: unknown[]) => {
      ctx = { ...folder.ctx, repo: { catalog: async () => ({ entries }) } } as typeof ctx;
    };
    withCatalog([entry("StatCard")]);
    const unused = await ok("import_theme", { cssPath: "globals.css" });
    expect(unused).not.toHaveProperty("chartHint");
    expect(unused).not.toHaveProperty("detectedChartLibs");

    // Drawn with: its components are the app's own, already on the Repo shelves.
    withCatalog([entry("StatCard"), entry("AreaChart", "recharts")]);
    const drawn = await ok("import_theme", { cssPath: "globals.css" });
    expect(drawn.detectedChartLibs).toEqual(["recharts"]);
    expect(drawn.chartHint).toContain("Repo shelves");
  });

  test("an app with no chart library gets no hint", async () => {
    await writeFile(join(hostRoot, "package.json"), JSON.stringify({ name: "app" }));
    const result = await ok("import_theme", { cssPath: "globals.css" });
    expect(result).not.toHaveProperty("detectedChartLibs");
    expect(result).not.toHaveProperty("chartHint");
  });

  test("a malformed package.json is skipped rather than fatal", async () => {
    await writeFile(join(hostRoot, "package.json"), "{ not json");
    expect((await ok("import_theme", { cssPath: "globals.css" })).changeCount).toBeGreaterThan(0);
  });

  test("pasted css text needs no path at all", async () => {
    const result = await ok("import_theme", { css: GLOBALS_CSS });
    expect(result.changeCount).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("container");
  });
});

describe("score_theme_contrast", () => {
  test("scores both palettes by default, with a summary that adds up", async () => {
    const result = (await ok("score_theme_contrast")) as {
      summary: { total: number; passes: number; fails: number };
      results: { tier: string }[];
    };
    expect(result.results.length).toBe(result.summary.total);
    expect(result.summary.passes + result.summary.fails).toBe(result.summary.total);
  });

  test("scores one palette when asked", async () => {
    const both = (await ok("score_theme_contrast")) as { summary: { total: number } };
    const light = (await ok("score_theme_contrast", { mode: "light" })) as {
      summary: { total: number };
    };
    expect(light.summary.total).toBeLessThan(both.summary.total);
  });

  test("counts a deliberately unreadable pair as a failure", async () => {
    await ok("set_theme", {
      tokens: { "colors.background": "#ffffff", "colors.foreground": "#fefefe" },
    });
    const result = (await ok("score_theme_contrast", { mode: "light" })) as {
      summary: { fails: number };
    };
    expect(result.summary.fails).toBeGreaterThan(0);
  });

  test("a theme that doesn't exist is refused", async () => {
    const error = await fails("score_theme_contrast", { theme: "ghost" });
    expect(error.kind).toBe("BadRequest");
  });
});

describe("import_theme — DESIGN.md", () => {
  const DESIGN_MD = `---
name: Paws & Paths
colors:
  background: "#f9f9ff"
  on-background: "#151c27"
  primary: "#855300"
  on-primary: "#ffffff"
  error: "#ba1a1a"
  outline: "#867461"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
---

## Do's and Don'ts

- Do keep the surface calm.
`;

  test("reads a DESIGN.md sitting at the host app root", async () => {
    await writeFile(join(hostRoot, "DESIGN.md"), DESIGN_MD, "utf8");
    const result = await ok("import_theme", { designMdPath: "DESIGN.md" });
    expect(result.source).toBe("design.md");
    expect(result.designSystem).toBe("Paws & Paths");
    expect(result.applied).toBe(false);
    const coverage = result.coverage as { semantic: number; aliased: unknown[]; summary: string };
    // The Material-3 names are the point: without the alias table this file
    // would map `background` and `primary` only.
    expect(coverage.aliased.length).toBeGreaterThan(0);
    expect(coverage.summary).toContain("via alias names");
  });

  test("applies to the live theme", async () => {
    await writeFile(join(hostRoot, "DESIGN.md"), DESIGN_MD, "utf8");
    await ok("import_theme", { designMdPath: "DESIGN.md", apply: true });
    expect(liveTheme().colors.background).toBe("#f9f9ff");
    expect(liveTheme().colors.destructive).toMatchObject({ DEFAULT: "#ba1a1a" });
    expect(liveTheme().colors.border).toBe("#867461");
  });

  test("takes the file as text too", async () => {
    const result = await ok("import_theme", { designMd: DESIGN_MD });
    expect(result.designSystem).toBe("Paws & Paths");
  });

  test("inline text has no file to follow, and says so", async () => {
    const result = await ok("import_theme", { designMd: DESIGN_MD });
    const prose = result.prose as { sections: string[]; note: string };
    expect(prose.sections).toEqual(["Do's and Don'ts"]);
    expect(prose.note).toContain("no file for the folder to follow");
  });

  test("importing by path records the file, without copying it", async () => {
    await writeFile(join(hostRoot, "DESIGN.md"), DESIGN_MD, "utf8");
    await ok("import_theme", { designMdPath: "DESIGN.md", apply: true });
    // The config points at the file; the folder holds no copy of the prose.
    expect(ctx.folder.config.designSystem?.path).toBe("DESIGN.md");
    const result = await ok("import_theme", { designMdPath: "DESIGN.md" });
    expect((result.prose as { note: string }).note).toContain("re-reads it each time");
  });

  test("names components as dropped rather than silently ignoring them", async () => {
    const result = await ok("import_theme", { designMd: DESIGN_MD });
    const dropped = result.dropped as { section: string; count: number }[];
    expect(dropped.find((d) => d.section === "components")?.count).toBe(1);
  });

  test("refuses a stylesheet and a DESIGN.md in the same call", async () => {
    const error = await fails("import_theme", { designMd: DESIGN_MD, cssPath: "globals.css" });
    expect(error.kind).toBe("BadRequest");
    expect(error.message).toContain("not both");
  });

  test("says where it looked when the path is wrong", async () => {
    const error = await fails("import_theme", { designMdPath: "nope/DESIGN.md" });
    expect(error.kind).toBe("BadRequest");
    expect(error.message).toContain("nope/DESIGN.md");
  });

  test('mode: "dark" routes the palette into colorsDark', async () => {
    const before = liveTheme().colors.background;
    await ok("import_theme", { designMd: DESIGN_MD, mode: "dark", apply: true });
    expect(liveTheme().colors.background).toBe(before);
    expect(liveTheme().colorsDark?.background).toBe("#f9f9ff");
  });

  test("a dark import does not take over the document the design follows", async () => {
    await writeFile(join(hostRoot, "DESIGN.md"), DESIGN_MD, "utf8");
    await writeFile(join(hostRoot, "DESIGN.dark.md"), DESIGN_MD, "utf8");
    await ok("import_theme", { designMdPath: "DESIGN.md", apply: true });
    await ok("import_theme", { designMdPath: "DESIGN.dark.md", mode: "dark", apply: true });
    expect(ctx.folder.config.designSystem?.path).toBe("DESIGN.md");
  });

  test("a file outside the app is imported but not followed, and says so", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "velloo-theme-elsewhere-"));
    try {
      await writeFile(join(elsewhere, "DESIGN.md"), DESIGN_MD, "utf8");
      const result = await ok("import_theme", {
        designMdPath: join(elsewhere, "DESIGN.md"),
        apply: true,
      });
      expect(liveTheme().colors.background).toBe("#f9f9ff");
      expect(ctx.folder.config.designSystem).toBeUndefined();
      expect((result.warnings as string[]).join(" ")).toContain("outside the app root");
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
