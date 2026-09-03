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
  getCustomCss,
  importThemeCss,
  listThemes,
  PRESET_NAMES,
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
import { singleOrBulkError } from "./schemas.ts";

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
      if (args.tokens !== undefined && (args.path !== undefined || args.value !== undefined)) {
        return errorResult({
          kind: "BadRequest",
          message: singleOrBulkError.both("set_token", "path+value", "tokens"),
        });
      }
      const entries: TokenEntry[] = args.tokens
        ? Object.entries(args.tokens).map(([path, value]) => ({ path, value }))
        : args.path !== undefined && args.value !== undefined
          ? [{ path: args.path, value: args.value }]
          : [];
      if (entries.length === 0) {
        return errorResult({
          kind: "BadRequest",
          message: singleOrBulkError.missing("set_token", "path+value", "tokens"),
        });
      }
      // One lock + one validation pass + one persist + one broadcast for the
      // whole batch; all-or-nothing with a per-entry report on failure.
      const r = await setTokens(ctx, entries, args.theme);
      if (!r.ok) return errorResult(r.error);
      const applied = r.value.applied;
      // A palette token named after a semantic slot would emit a duplicate
      // `--color-<name>` — the emit paths skip it, so warn at the source.
      const warnings: string[] = [];
      for (const path of applied) {
        const m = /^palette(?:Dark)?\.([a-z0-9-]+)$/.exec(path);
        const name = m?.[1];
        if (name && SEMANTIC_SLOTS.has(name)) {
          warnings.push(
            `\`${path}\` shadows the semantic slot \`${name}\` and is skipped on emit and in the canvas (the semantic \`--color-${name}\` wins). Set \`colors.${name}\` / \`colorsDark.${name}\` instead, or rename the palette token (e.g. \`brand-${name}\`).`,
          );
        }
      }
      return jsonResult({
        applied,
        theme: args.theme ?? "default",
        ...(warnings.length > 0 ? { warnings } : {}),
      });
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
    "set_typeset",
    {
      description:
        'Set a typeset — the typographic rhythm. Three controls: `size` (base text size; "1em" follows the container, 15 pins it), `leading` (body line-height; the whole heading ladder derives from it), `flow` (space between blocks). Everything visible follows: h1–h6 sizes, copy sizes, heading margins. Name "default" is the folder baseline and styles every screen; any other name becomes a preset a Prose region opts into (`preset: "docs"`). Reach for this instead of setting per-node text-* classes — one call re-rhythms the whole design coherently. `fontHeading` / `fontBody` / `fontMono` take a role declared by set_fonts.',
      inputSchema: {
        typesets: z
          .array(
            z.object({
              name: z
                .string()
                .optional()
                .describe('Typeset name; default "default" (the folder baseline)'),
              renameTo: z
                .string()
                .optional()
                .describe("Rename this preset, carrying its authored controls over"),
              remove: z
                .boolean()
                .optional()
                .describe("Delete this preset; regions still carrying its class fall back"),
              size: z
                .union([z.string(), z.number(), z.null()])
                .optional()
                .describe('Base text size — "1em" (container-relative), 15, or "15px"'),
              leading: z
                .union([z.number(), z.null()])
                .optional()
                .describe(
                  "Body line-height, unitless — e.g. 1.75. Heading leading derives from it",
                ),
              flow: z
                .union([z.string(), z.number(), z.null()])
                .optional()
                .describe('Space between blocks — e.g. "1.25em"'),
              fontBody: z
                .union([z.string(), z.null()])
                .optional()
                .describe("A font role from set_fonts, for body copy"),
              fontHeading: z
                .union([z.string(), z.null()])
                .optional()
                .describe("A font role from set_fonts, for headings"),
              fontMono: z
                .union([z.string(), z.null()])
                .optional()
                .describe("A font role from set_fonts, for code"),
            }),
          )
          .min(1),
        theme: z.string().optional().describe('Named theme to edit; default "default"'),
      },
    },
    async (args) => {
      const r = await setTypeset(ctx, args.typesets, args.theme);
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
        "Code-to-design: seed the theme from an existing app's stylesheet instead of picking colors by hand. Parses shadcn-convention custom properties — `:root` / `.dark` `--background`-style vars (raw HSL triplets or any CSS color) and Tailwind v4 `@theme` `--color-*` vars, with var() indirection resolved — plus `--radius` and `--font-*` roles. **Also captures every non-semantic color var into the theme's `palette`** — numeric scales (`--primary-600`), extra roles (`--success-500`), bare brand names (`--ink`) — so verbatim app classes like `bg-primary-600` / `bg-ink` resolve literally on the canvas instead of silently falling back; apply this BEFORE porting screens. (`palette.*` entries are raw passthroughs that don't theme-flip, unlike the semantic `colors.*` slots; tweak them with `set_token palette.<name>`.) Slots the CSS doesn't declare keep their current values. Pass `css` text directly, or `cssPath` to the app's globals.css. When given a `cssPath`, it also reads the nearby tailwind.config (or an explicit `tailwindConfigPath`) and ingests its `theme.extend` — **brand `colors` → `palette`, named `spacing` → spacing tokens (`w-icon-rail`), `boxShadow` → `shadows` (`shadow-card`), `fontFamily` → font roles, `keyframes` + `animation` → `--animate-*`** — the tokens an app keeps in JS config rather than the stylesheet; CSS-derived values win over config literals of the same name. It also applies the app's `container` config so `class=\"container\"` centers/pads/caps to match, reporting the equivalent `container.suggestedClasses` if you'd rather wrap content explicitly. Dry-run by default: returns the would-be token changes; pass apply: true to persist.",
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
        'Score WCAG contrast ratios for a theme\'s salient color pairs (foreground/background, primary/primary-foreground, …) in BOTH light and dark palettes — each result carries mode: "light" | "dark". Returns ratio + tier (AAA / AA / AAlarge / Fail). Pass mode to score one palette only; pass theme to score a named theme instead of the default. Use after a derive/preset or any dark-token tuning to confirm accessibility before shipping.',
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
