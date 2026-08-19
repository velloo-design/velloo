import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { containerClasses, parseTailwindContainer } from "@velloo/codegen";
import type { Result } from "@velloo/result";
import { z } from "zod";
import type { ThemeError } from "../../theme/errors.ts";
import {
  addTheme,
  applyPreset,
  derivePaletteFromColor,
  getCustomCss,
  importThemeCss,
  listThemes,
  PRESET_NAMES,
  scoreThemeContrast,
  scoreThemeContrastBoth,
  setCustomCss,
  setFonts,
  setToken,
  type ThemeContext,
} from "../../theme/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function themeErrorResult(error: ThemeError): McpResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] };
}

function toMcp<T>(result: Result<T, ThemeError>): McpResult {
  return result.ok ? jsonResult(result.value) : themeErrorResult(result.error);
}

const TW_CONFIG_NAMES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.cjs",
];

/**
 * Locate the host app's tailwind config: an explicit path, else walk up from
 * the imported stylesheet's directory (globals.css usually sits a level or two
 * below the config). Bounded; returns the source text or null.
 */
async function readTailwindConfig(
  explicitPath: string | undefined,
  cssResolvedPath: string | undefined,
  folderRoot: string,
): Promise<string | null> {
  if (explicitPath) {
    const p = isAbsolute(explicitPath) ? explicitPath : join(folderRoot, explicitPath);
    return readFile(p, "utf8").catch(() => null);
  }
  if (!cssResolvedPath) return null;
  let dir = dirname(cssResolvedPath);
  for (let i = 0; i < 5; i++) {
    for (const name of TW_CONFIG_NAMES) {
      const hit = await readFile(join(dir, name), "utf8").catch(() => null);
      if (hit !== null) return hit;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Container config is JS, not CSS, and Velloo has no container theme concept —
 * so surface it as advisory guidance (the equivalent classes), never applied.
 */
async function detectContainer(
  explicitPath: string | undefined,
  cssResolvedPath: string | undefined,
  folderRoot: string,
): Promise<{ detected: unknown; suggestedClasses: string; note: string } | null> {
  const src = await readTailwindConfig(explicitPath, cssResolvedPath, folderRoot);
  if (src === null) return null;
  const detected = parseTailwindContainer(src);
  if (!detected) return null;
  const suggestedClasses = containerClasses(detected);
  return {
    detected,
    suggestedClasses,
    note: "the app's Tailwind `container` config isn't a Velloo theme concept, so it wasn't applied — wrap page content in a `Box` with `suggestedClasses` (or use the `Container` component) to match it.",
  };
}

export function registerThemeTools(mcp: McpServer, ctx: ThemeContext): void {
  mcp.registerTool(
    "set_token",
    {
      description:
        'Set theme tokens at dot-paths. Two namespaces: `colors.*` / `colorsDark.*` are the semantic slots (e.g. "colors.primary.DEFAULT", "colorsDark.background") that drive component chrome and theme-flip in dark mode; `palette.*` (e.g. "palette.ink", "palette.primary-600") is a flat passthrough of raw brand colors that does NOT flip — set `palette.ink "#1a1a1a"` and `bg-ink`/`text-ink`/`border-ink` resolve literally (the mechanism that makes a host app\'s verbatim brand classes work; `import_theme` populates it automatically). Single: path + value. Bulk: tokens: { "<path>": <value>, … } applied in order. The full theme is schema-validated after each patch. Returns the applied paths — call get_theme when you need the full tree.',
      inputSchema: {
        path: z.string().optional(),
        value: z.union([z.string(), z.number()]).optional(),
        tokens: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional()
          .describe("Bulk mode — mutually exclusive with path/value"),
        theme: z.string().optional().describe('Named theme to edit; default "default"'),
      },
    },
    async (args) => {
      const entries: Array<[string, string | number]> = args.tokens
        ? Object.entries(args.tokens)
        : args.path !== undefined && args.value !== undefined
          ? [[args.path, args.value]]
          : [];
      if (entries.length === 0) {
        return themeErrorResult({
          kind: "BadRequest",
          message: "set_token: pass path + value, or tokens: { <path>: <value>, … }.",
        });
      }
      const applied: string[] = [];
      for (const [path, value] of entries) {
        const r = await setToken(ctx, path, value, args.theme);
        if (!r.ok) return themeErrorResult(r.error);
        applied.push(path);
      }
      return jsonResult({ applied, theme: args.theme ?? "default" });
    },
  );

  mcp.registerTool(
    "set_fonts",
    {
      description:
        'Declare font roles: role "display" → token --font-display → class font-display. `google` loads from Google Fonts (axis spec like "wght@400..900", or true). Declare a display face before composing — typography is the biggest personality lever.',
      inputSchema: {
        fonts: z
          .array(
            z.object({
              role: z
                .string()
                .describe('Token role, e.g. "display", "sans", "mono" — any utility-safe name'),
              family: z.string().describe('Family name, e.g. "Unbounded"'),
              fallback: z.string().optional().describe("CSS stack tail; sensible default per role"),
              google: z
                .union([z.string(), z.literal(true)])
                .optional()
                .describe('Google Fonts axis spec ("wght@400..900") or true for a plain load'),
            }),
          )
          .min(1),
        theme: z.string().optional().describe('Named theme to edit; default "default"'),
      },
    },
    async (args) => {
      const r = await setFonts(ctx, args.fonts, args.theme);
      return toMcp(r.ok ? { ok: true, value: { theme: r.value } } : r);
    },
  );

  mcp.registerTool(
    "custom_css",
    {
      description:
        "Read (omit css) or replace theme/custom.css — keyframes, grain, clip-paths, anything utilities can't express. Injected into every render and appended to emitted globals.css. Replaces the whole file: read first when editing.",
      inputSchema: {
        css: z.string().optional(),
      },
    },
    async (args) => {
      if (args.css === undefined) return jsonResult(getCustomCss(ctx));
      return toMcp(await setCustomCss(ctx, args.css));
    },
  );

  mcp.registerTool(
    "add_theme",
    {
      description:
        "Create a named theme (theme/<name>.json) by cloning an existing one. Boards pick it up via update_board { patch: { theme: <name> } }; renders and screenshots accept theme: <name>. Edit it afterwards with set_token / set_fonts + their theme param.",
      inputSchema: {
        name: z.string().describe("Lowercase kebab, not 'default'"),
        from: z.string().optional().describe("Source theme to clone; default 'default'"),
        overwrite: z.boolean().optional(),
      },
    },
    async (args) => toMcp(await addTheme(ctx, args.name, args.from, args.overwrite ?? false)),
  );

  mcp.registerTool(
    "list_themes",
    {
      description: "List named themes and which boards use each.",
      inputSchema: {},
    },
    async () => jsonResult(listThemes(ctx)),
  );

  mcp.registerTool(
    "apply_preset",
    {
      description: `Replace the active theme with a named preset. Known presets: ${PRESET_NAMES.join(", ")}.`,
      inputSchema: { presetName: z.string() },
    },
    async (args) => {
      const r = await applyPreset(ctx, args.presetName);
      return toMcp(r.ok ? { ok: true, value: { theme: r.value } } : r);
    },
  );

  mcp.registerTool(
    "derive_palette_from_color",
    {
      description:
        "Generate a full OKLCH-based color palette from a seed color (#hex, oklch(), rgb(), etc.) and apply it as the new theme. Foreground/background contrast is auto-adjusted to WCAG AA.",
      inputSchema: {
        seedColor: z.string(),
        name: z.string().optional(),
      },
    },
    async (args) => toMcp(await derivePaletteFromColor(ctx, args.seedColor, args.name)),
  );

  mcp.registerTool(
    "import_theme",
    {
      description:
        "Code-to-design: seed the theme from an existing app's stylesheet instead of picking colors by hand. Parses shadcn-convention custom properties — `:root` / `.dark` `--background`-style vars (raw HSL triplets or any CSS color) and Tailwind v4 `@theme` `--color-*` vars, with var() indirection resolved — plus `--radius` and `--font-*` roles. **Also captures every non-semantic color var** — numeric scales (`--primary-600`), extra roles (`--success-500`, `--danger`), AND bare brand names (`--paprika`, `--ink`, `--teal`) — into the theme's `palette`, so verbatim app classes like `bg-primary-600` / `text-success-500` / `bg-ink` resolve literally on the canvas instead of silently falling back to the default palette — apply this BEFORE porting screens so copied classes render. (`palette.*` entries are raw passthroughs that don't theme-flip, unlike the semantic `colors.*` slots; tweak them by hand with `set_token palette.<name>`.) Slots the CSS doesn't declare keep their current values. Pass `css` text directly, or `cssPath` (absolute, or relative to the design folder) to the app's globals.css. When given a `cssPath`, it also reads the nearby tailwind.config (or an explicit `tailwindConfigPath`) and reports the app's `container` settings as `container.suggestedClasses` — Velloo has no container theme concept, so wrap page content in a `Box` with those classes (or use `Container`) instead of reverse-engineering them. Dry-run by default: returns the would-be token changes; pass apply: true to persist.",
      inputSchema: {
        css: z.string().optional().describe("Stylesheet text (use this OR cssPath)"),
        cssPath: z
          .string()
          .optional()
          .describe("Path to the stylesheet — absolute, or relative to the design folder"),
        theme: z.string().optional().describe('Named theme to merge into; default "default"'),
        apply: z.boolean().optional().describe("Persist the merge (default false = dry-run)"),
        tailwindConfigPath: z
          .string()
          .optional()
          .describe(
            "Path to the app's tailwind.config (absolute, or relative to the design folder). Auto-detected near `cssPath` when omitted; used only to report the app's `container` settings as guidance.",
          ),
      },
    },
    async (args) => {
      let css = args.css;
      let cssResolvedPath: string | undefined;
      if (css === undefined) {
        if (args.cssPath === undefined) {
          return themeErrorResult({
            kind: "BadRequest",
            message: "pass either `css` text or a `cssPath`",
          });
        }
        cssResolvedPath = isAbsolute(args.cssPath)
          ? args.cssPath
          : join(ctx.folder.root, args.cssPath);
        try {
          css = await readFile(cssResolvedPath, "utf8");
        } catch (e) {
          return themeErrorResult({
            kind: "BadRequest",
            message: `could not read ${cssResolvedPath}: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      const r = await importThemeCss(ctx, css, {
        ...(args.theme !== undefined ? { themeName: args.theme } : {}),
        ...(args.apply !== undefined ? { apply: args.apply } : {}),
      });
      if (!r.ok) return themeErrorResult(r.error);
      const { changes, warnings, applied } = r.value;
      const container = await detectContainer(
        args.tailwindConfigPath,
        cssResolvedPath,
        ctx.folder.root,
      );
      return jsonResult({
        applied,
        changeCount: changes.length,
        changes,
        warnings,
        ...(container ? { container } : {}),
        ...(applied ? {} : { note: "dry-run — pass apply: true to persist these changes" }),
      });
    },
  );

  mcp.registerTool(
    "score_theme_contrast",
    {
      description:
        'Score WCAG contrast ratios for the active theme\'s salient color pairs (foreground/background, primary/primary-foreground, …) in BOTH light and dark palettes — each result carries mode: "light" | "dark". Returns ratio + tier (AAA / AA / AAlarge / Fail). Pass mode to score one palette only. Use after a derive/preset or any dark-token tuning to confirm accessibility before shipping.',
      inputSchema: {
        mode: z
          .enum(["light", "dark"])
          .optional()
          .describe("Score only this palette; default both"),
      },
    },
    async (args) => {
      const results = args.mode
        ? scoreThemeContrast(ctx.folder.theme, args.mode)
        : scoreThemeContrastBoth(ctx.folder.theme);
      const fails = results.filter((r) => r.tier === "Fail").length;
      const passes = results.length - fails;
      return jsonResult({ summary: { total: results.length, passes, fails }, results });
    },
  );
}
