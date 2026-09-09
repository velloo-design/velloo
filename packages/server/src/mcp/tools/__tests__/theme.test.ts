import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("a token path the theme doesn't have is refused", async () => {
    await fails("set_theme", { tokens: { "colors.nope.DEFAULT": "#fff" } });
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
