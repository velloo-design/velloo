import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { containerClasses, parseTailwindContainer, SEMANTIC_SLOTS } from "@velloo/codegen";
import { z } from "zod";
import { type DesignFolder, resolveNamedTheme } from "../../design-folder.ts";
import { chartLibsInDeps } from "../../theme/chart-libs.ts";
import {
  addTheme,
  applyPreset,
  derivePaletteFromColor,
  importThemeCss,
  listThemes,
  PRESET_NAMES,
  removeTheme,
  renameTheme,
  scoreThemeContrast,
  scoreThemeContrastBoth,
  setCustomCss,
  setFonts,
  setTokens,
  setTypeset,
  type ThemeContext,
  type TokenEntry,
} from "../../theme/index.ts";
import { errorResult, jsonResult, toMcp } from "./result.ts";

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
 * Find + read the host app's package.json: prefer the configured
 * `hostApp.root`, else walk up from the imported stylesheet (globals.css sits
 * inside the app). Bounded; returns the parsed JSON or null.
 */
async function readHostPackageJson(
  folder: DesignFolder,
  cssResolvedPath: string | undefined,
): Promise<Record<string, unknown> | null> {
  const candidates: string[] = [];
  const hostRoot = folder.config.hostApp?.root;
  if (hostRoot) {
    candidates.push(
      isAbsolute(hostRoot)
        ? join(hostRoot, "package.json")
        : join(folder.root, hostRoot, "package.json"),
    );
  }
  if (cssResolvedPath) {
    let dir = dirname(cssResolvedPath);
    for (let i = 0; i < 6; i++) {
      candidates.push(join(dir, "package.json"));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const p of candidates) {
    const txt = await readFile(p, "utf8").catch(() => null);
    if (txt === null) continue;
    try {
      return JSON.parse(txt) as Record<string, unknown>;
    } catch {
      // Malformed package.json — skip and try the next candidate.
    }
  }
  return null;
}

/**
 * Client chart libraries the host app depends on — the signal that the agent
 * should register the app's own chart components as `render:"live"` extensions
 * (the built-in echarts Chart won't pixel-match recharts/visx/etc.).
 */
async function detectChartLibs(
  folder: DesignFolder,
  cssResolvedPath: string | undefined,
): Promise<string[]> {
  const pkg = await readHostPackageJson(folder, cssResolvedPath);
  if (!pkg) return [];
  const deps = {
    ...((pkg.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown> | undefined) ?? {}),
  };
  return chartLibsInDeps(deps);
}

/**
 * Report the detected container alongside the equivalent utility classes.
 * The config is also applied to the theme (importThemeCss) — this is the
 * agent-facing echo of what landed, plus a wrap-it-yourself fallback.
 */
function detectContainer(
  src: string | null,
): { detected: unknown; suggestedClasses: string; note: string } | null {
  if (src === null) return null;
  const detected = parseTailwindContainer(src);
  if (!detected) return null;
  const suggestedClasses = containerClasses(detected);
  return {
    detected,
    suggestedClasses,
    note: 'applied to the theme — `class="container"` now centers/pads/caps to match the app. `suggestedClasses` are the equivalent utilities if you\'d rather wrap content in a `Box` explicitly.',
  };
}

export function registerThemeTools(mcp: McpServer, ctx: ThemeContext): void {
  mcp.registerTool(
    "set_theme",
    {
      description:
        "Edit the theme through one verb — pass any combination of channels. `tokens` patches dot-paths (`colors.*` / `colorsDark.*` are the semantic slots that theme-flip; `palette.*` is a non-flipping passthrough for raw brand colors). `fonts` declares font roles. `typeset` sets the type rhythm the whole ladder derives from — reach for it instead of per-node `text-*`. `customCss` replaces theme/custom.css. `from` reseeds from a preset or seed color before the other channels apply. Guide: velloo://guide/theme.",
      inputSchema: {
        theme: z.string().optional().describe('Named theme to edit; default "default"'),
        tokens: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional()
          .describe('Dot-path patch, e.g. { "colors.primary.DEFAULT": "#4f46e5" }'),
        from: z
          .union([z.object({ preset: z.enum(PRESET_NAMES) }), z.object({ seedColor: z.string() })])
          .optional()
          .describe("Reseed the whole palette; applied before the other channels"),
        fonts: z
          .array(
            z.object({
              role: z
                .string()
                .describe('Token role, e.g. "display", "sans", "mono" — any utility-safe name'),
              family: z
                .string()
                .optional()
                .describe('Family name, e.g. "Unbounded". Required unless removing'),
              fallback: z.string().optional().describe("CSS stack tail; sensible default per role"),
              google: z
                .union([z.string(), z.literal(true)])
                .optional()
                .describe('Google Fonts axis spec ("wght@400..900") or true for a plain load'),
              remove: z
                .boolean()
                .optional()
                .describe("Drop this role; refused while a typeset still names it"),
            }),
          )
          .min(1)
          .optional(),
        typeset: z
          .array(
            z.object({
              name: z
                .string()
                .optional()
                .describe(
                  'Typeset name; default "default" (the folder baseline). Any other name becomes a preset a Prose region opts into',
                ),
              renameTo: z.string().optional(),
              remove: z.boolean().optional(),
              size: z
                .union([z.string(), z.number(), z.null()])
                .optional()
                .describe('Base text size — "1em" (container-relative), 15, or "15px"'),
              leading: z
                .union([z.number(), z.null()])
                .optional()
                .describe("Body line-height, unitless. The heading ladder derives from it"),
              flow: z
                .union([z.string(), z.number(), z.null()])
                .optional()
                .describe('Space between blocks — e.g. "1.25em"'),
              fontBody: z.union([z.string(), z.null()]).optional().describe("A role from `fonts`"),
              fontHeading: z
                .union([z.string(), z.null()])
                .optional()
                .describe("A role from `fonts`"),
              fontMono: z.union([z.string(), z.null()]).optional().describe("A role from `fonts`"),
            }),
          )
          .min(1)
          .optional(),
        customCss: z
          .string()
          .optional()
          .describe("Replaces theme/custom.css entirely — read it first via get_theme"),
      },
    },
    async (args) => {
      const channels = ["from", "tokens", "fonts", "typeset", "customCss"] as const;
      if (channels.every((c) => args[c] === undefined)) {
        return errorResult({
          kind: "BadRequest",
          message: `set_theme: pass at least one of ${channels.join(", ")}.`,
        });
      }
      const applied: Record<string, unknown> = {};

      // `from` reseeds wholesale, so it runs first — a token patch in the same
      // call is then an override of the new palette rather than of the old one.
      if (args.from) {
        const seeded =
          "preset" in args.from
            ? await applyPreset(ctx, args.from.preset, args.theme)
            : await derivePaletteFromColor(ctx, args.from.seedColor, args.theme);
        if (!seeded.ok) return errorResult(seeded.error);
        applied.from = args.from;
      }

      if (args.tokens) {
        const entries: TokenEntry[] = Object.entries(args.tokens).map(([path, value]) => ({
          path,
          value,
        }));
        const r = await setTokens(ctx, entries, args.theme);
        if (!r.ok) return errorResult(r.error);
        applied.tokens = r.value.applied;
        // A palette token named after a semantic slot would emit a duplicate
        // `--color-<name>` — the emit paths skip it, so warn at the source.
        const warnings: string[] = [];
        for (const path of r.value.applied) {
          const m = /^palette(?:Dark)?\.([a-z0-9-]+)$/.exec(path);
          const name = m?.[1];
          if (name && SEMANTIC_SLOTS.has(name)) {
            warnings.push(
              `\`${path}\` shadows the semantic slot \`${name}\` and is skipped on emit and in the canvas (the semantic \`--color-${name}\` wins). Set \`colors.${name}\` / \`colorsDark.${name}\` instead, or rename the palette token (e.g. \`brand-${name}\`).`,
            );
          }
        }
        if (warnings.length > 0) applied.warnings = warnings;
      }

      if (args.fonts) {
        const r = await setFonts(ctx, args.fonts, args.theme);
        if (!r.ok) return errorResult(r.error);
        applied.fonts = args.fonts.map((f) => f.role);
      }

      if (args.typeset) {
        const r = await setTypeset(ctx, args.typeset, args.theme);
        if (!r.ok) return errorResult(r.error);
        applied.typeset = args.typeset.map((t) => t.name ?? "default");
      }

      if (args.customCss !== undefined) {
        const r = await setCustomCss(ctx, args.customCss);
        if (!r.ok) return errorResult(r.error);
        applied.customCss = { bytes: r.value.bytes };
      }

      return jsonResult({ theme: args.theme ?? "default", applied });
    },
  );

  mcp.registerTool(
    "add_theme",
    {
      description:
        "Create a named theme (theme/<name>.json) by cloning an existing one. Boards pin it via update_board { patch: { theme } }; renders accept theme:. Edit it with set_theme's own theme param.",
      inputSchema: {
        name: z.string().describe("Lowercase kebab, not 'default'"),
        from: z.string().optional().describe("Source theme to clone; default 'default'"),
        overwrite: z.boolean().optional(),
      },
    },
    async (args) => toMcp(await addTheme(ctx, args.name, args.from, args.overwrite ?? false)),
  );

  mcp.registerTool(
    "update_theme",
    {
      description:
        "Rename a named theme, repointing every board that pinned it (the response lists them). To change a theme's *tokens*, use set_theme with its `theme` param.",
      inputSchema: {
        name: z.string().describe("Theme to rename"),
        renameTo: z.string().describe("New name — lowercase kebab, not 'default'"),
      },
    },
    async (args) => toMcp(await renameTheme(ctx, args.name, args.renameTo)),
  );

  mcp.registerTool(
    "remove_theme",
    {
      description:
        "Delete a named theme. Refuses while any board still pins it, naming those boards — repoint or unpin them first with update_board { patch: { theme } }. The default theme cannot be removed.",
      inputSchema: { name: z.string() },
    },
    async (args) => toMcp(await removeTheme(ctx, args.name)),
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
    "import_theme",
    {
      description:
        "Code-to-design: seed the theme from an existing app's stylesheet instead of picking colors by hand — semantic slots, the raw `palette.*` passthrough for brand vars, fonts, radius, and the nearby tailwind.config's `theme.extend`. Dry-run by default; pass `apply: true` to persist. Run this BEFORE porting screens. Guide: velloo://guide/theme.",
      inputSchema: {
        css: z.string().optional().describe("Stylesheet text (use this OR cssPath)"),
        cssPath: z
          .string()
          .optional()
          .describe(
            "Path to the stylesheet — absolute, or relative to the HOST APP root (where globals.css lives, normally OUTSIDE the design folder); the design folder is tried as a last resort",
          ),
        theme: z.string().optional().describe('Named theme to merge into; default "default"'),
        apply: z.boolean().optional().describe("Persist the merge (default false = dry-run)"),
        tailwindConfigPath: z
          .string()
          .optional()
          .describe(
            "Path to the app's tailwind.config (absolute, or relative to the design folder). Auto-detected near `cssPath` when omitted; its `theme.extend` (colors, boxShadow, fontFamily) is ingested and its `container` reported as guidance.",
          ),
      },
    },
    async (args) => {
      // Treat an empty/whitespace `css` as not-provided (agents sometimes pass css:"" + cssPath).
      let css: string | undefined = args.css?.trim() ? args.css : undefined;
      let cssResolvedPath: string | undefined;
      if (css === undefined) {
        if (args.cssPath === undefined) {
          return errorResult({
            kind: "BadRequest",
            message: "pass either `css` text or a `cssPath`",
          });
        }
        // The host app's globals.css lives OUTSIDE the design folder (which sits at
        // <appRoot>/velloo). Try the host app root, then the design folder's parent, then
        // the design folder itself — read the first that exists.
        const hostRoot = ctx.folder.config.hostApp?.root;
        const bases: string[] = isAbsolute(args.cssPath)
          ? [""]
          : [
              ...(hostRoot
                ? [isAbsolute(hostRoot) ? hostRoot : join(ctx.folder.root, hostRoot)]
                : []),
              join(ctx.folder.root, ".."),
              ctx.folder.root,
            ];
        const tried: string[] = [];
        for (const base of bases) {
          const candidate = base === "" ? args.cssPath : join(base, args.cssPath);
          tried.push(candidate);
          const text = await readFile(candidate, "utf8").catch(() => null);
          if (text !== null) {
            css = text;
            cssResolvedPath = candidate;
            break;
          }
        }
        if (css === undefined) {
          return errorResult({
            kind: "BadRequest",
            message:
              `could not read "${args.cssPath}" — tried ${tried.map((t) => `"${t}"`).join(", ")}. ` +
              `The host app's globals.css usually lives OUTSIDE the design folder (the design folder is at <appRoot>/velloo). ` +
              `Pass an absolute path, a path relative to the host app root, or paste the stylesheet text directly as \`css\`.`,
          });
        }
      }
      // Read the host tailwind.config once: its theme.extend feeds the merge
      // (brand colors / shadows / fonts) and its container feeds the guidance.
      const tailwindConfig = await readTailwindConfig(
        args.tailwindConfigPath,
        cssResolvedPath,
        ctx.folder.root,
      );
      const r = await importThemeCss(ctx, css, {
        ...(args.theme !== undefined ? { themeName: args.theme } : {}),
        ...(args.apply !== undefined ? { apply: args.apply } : {}),
        ...(tailwindConfig !== null ? { tailwindConfig } : {}),
      });
      if (!r.ok) return errorResult(r.error);
      const { changes, warnings, applied } = r.value;
      const container = detectContainer(tailwindConfig);
      const detectedChartLibs = await detectChartLibs(ctx.folder, cssResolvedPath);
      return jsonResult({
        applied,
        changeCount: changes.length,
        changes,
        warnings,
        ...(container ? { container } : {}),
        ...(detectedChartLibs.length > 0
          ? {
              detectedChartLibs,
              chartHint:
                'this app uses a client chart library — register its chart components as render:"live" extensions (add_extension) so the canvas preview AND emitted code use the app\'s real charts; the built-in Chart previews via echarts and will not pixel-match.',
            }
          : {}),
        ...(applied ? {} : { note: "dry-run — pass apply: true to persist these changes" }),
      });
    },
  );

  mcp.registerTool(
    "score_theme_contrast",
    {
      description:
        "Score WCAG contrast for a theme's salient color pairs in both palettes — ratio + tier (AAA / AA / AAlarge / Fail) per pair. Run it after reseeding a palette or tuning dark tokens.",
      inputSchema: {
        mode: z
          .enum(["light", "dark"])
          .optional()
          .describe("Score only this palette; default both"),
        theme: z.string().optional().describe('Named theme to score; default "default"'),
      },
    },
    async (args) => {
      const resolved = resolveNamedTheme(ctx.folder, args.theme);
      if (!resolved.ok) {
        return errorResult({ kind: "BadRequest", message: resolved.message });
      }
      const results = args.mode
        ? scoreThemeContrast(resolved.theme, args.mode)
        : scoreThemeContrastBoth(resolved.theme);
      const fails = results.filter((r) => r.tier === "Fail").length;
      const passes = results.length - fails;
      return jsonResult({
        theme: args.theme ?? "default",
        summary: { total: results.length, passes, fails },
        results,
      });
    },
  );
}
