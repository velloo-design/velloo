import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { containerClasses, parseTailwindContainer, SEMANTIC_SLOTS } from "@velloo/codegen";
import { catalogFont } from "@velloo/schema/fonts";
import { z } from "zod";
import { type DesignFolder, resolveNamedTheme } from "../../design-folder.ts";
import { hostAppRootFrom } from "../../live/bundle-core.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { chartLibsInDeps } from "../../theme/chart-libs.ts";
import { findFontLoader } from "../../theme/font-loaders.ts";
import type { NotImported } from "../../theme/import-css.ts";
import {
  addTheme,
  applyPreset,
  derivePaletteFromColor,
  importThemeCss,
  importThemeDesignMd,
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
import {
  type ExpandedStylesheet,
  expandStylesheetImports,
} from "../../theme/stylesheet-imports.ts";
import { errorResult, jsonResult, toMcp } from "./result.ts";

/** Families a machine already has, or generic names: nothing needs to load them. */
const SYSTEM_FAMILY =
  /^(?:system-ui|ui-[a-z-]+|-apple-system|BlinkMacSystemFont|sans-serif|serif|monospace|Arial|Helvetica(?: Neue)?|Georgia|Times(?: New Roman)?|Courier(?: New)?|Menlo|Monaco|Consolas|Segoe UI|SF (?:Pro|Mono).*|Verdana|Tahoma)$/i;

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
    candidates.push(join(hostAppRootFrom(folder.root, folder.config.hostApp), "package.json"));
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

/**
 * Read a file an agent named for import. App files (globals.css, DESIGN.md)
 * normally live OUTSIDE the design folder, which sits at `<appRoot>/velloo`, so
 * a relative path tries the host app root, then the folder's parent, then the
 * folder itself — the first that reads wins.
 */
async function readAppFile(
  ctx: ThemeContext,
  path: string,
): Promise<{ text: string; path: string } | { tried: string[] }> {
  const hostRoot = ctx.folder.config.hostApp?.root;
  const candidates = isAbsolute(path)
    ? [path]
    : [
        ...(hostRoot ? [hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp)] : []),
        join(ctx.folder.root, ".."),
        ctx.folder.root,
      ].map((base) => join(base, path));
  for (const candidate of candidates) {
    const text = await readFile(candidate, "utf8").catch(() => null);
    if (text !== null) return { text, path: candidate };
  }
  return { tried: candidates };
}

/**
 * How far a stylesheet's relative `@import`s may reach: the app the design
 * belongs to. A sheet named from somewhere else entirely reaches no further
 * than its own directory.
 */
function importRootFor(folder: DesignFolder, sheet: string): string {
  const roots = [
    ...(folder.config.hostApp?.root ? [hostAppRootFrom(folder.root, folder.config.hostApp)] : []),
    join(folder.root, ".."),
  ];
  const holds = (root: string): boolean => {
    const rel = relative(root, sheet);
    return rel !== "" && !isAbsolute(rel) && !rel.split(sep).includes("..");
  };
  return roots.find(holds) ?? dirname(sheet);
}

/** The imports a stylesheet named that were not read, as one sentence each. */
function skippedImportNotes(expanded: ExpandedStylesheet): string[] {
  return expanded.skipped.map(
    (s) =>
      `\`@import "${s.specifier}"\` in ${s.from} was not read (${s.reason}) — if it holds tokens, import that file as \`cssPath\``,
  );
}

function triedList(tried: string[]): string {
  return tried.map((t) => `"${t}"`).join(", ");
}

/** Resolve + import a DESIGN.md, by path or pasted inline. */
async function importDesignMdResult(
  ctx: ThemeContext,
  args: {
    designMdPath?: string | undefined;
    theme?: string | undefined;
    apply?: boolean | undefined;
    mode?: "light" | "dark" | undefined;
  },
  inlineText: string | undefined,
) {
  let source = inlineText;
  let resolvedPath: string | undefined;
  if (source === undefined) {
    const read = await readAppFile(ctx, args.designMdPath as string);
    if ("tried" in read) {
      return errorResult({
        kind: "BadRequest",
        message:
          `could not read "${args.designMdPath}" — tried ${triedList(read.tried)}. ` +
          "A DESIGN.md usually sits at the repo root, OUTSIDE the design folder. " +
          "Pass an absolute path, a path relative to the host app root, or paste the file as `designMd`.",
      });
    }
    source = read.text;
    resolvedPath = read.path;
  }
  const r = await importThemeDesignMd(ctx, source, {
    ...(args.theme !== undefined ? { themeName: args.theme } : {}),
    ...(args.apply !== undefined ? { apply: args.apply } : {}),
    ...(args.mode !== undefined ? { mode: args.mode } : {}),
    ...(resolvedPath !== undefined ? { sourcePath: resolvedPath } : {}),
  });
  if (!r.ok) return errorResult(r.error);
  const { designSystem, changes, coverage, dropped, prose, warnings, applied, mode } = r.value;
  return jsonResult({
    source: "design.md",
    designSystem,
    mode,
    applied,
    changeCount: changes.length,
    coverage: {
      ...coverage,
      summary:
        `${coverage.semantic} of ${coverage.semanticTotal} semantic slots mapped ` +
        `(${coverage.aliased.length} via alias names); ${coverage.palette} palette passthrough`,
    },
    changes,
    dropped,
    // Not stored: the folder records the file's path and reads it live, so
    // the agents follow the document the repo has rather than a snapshot.
    prose: {
      ...prose,
      note:
        resolvedPath !== undefined
          ? "Velloo does not copy this prose. The folder now follows the file itself and re-reads it each time, so edit it in the repo. Read it before designing — the Do's and Don'ts section is a constraint list, not decoration."
          : "Pasted inline, so there is no file for the folder to follow. Keep the DESIGN.md in the repo and import it by path if you want the design agents to honour its prose.",
    },
    warnings,
    ...(applied ? {} : { note: "dry-run — pass apply: true to persist these changes" }),
  });
}

/**
 * Say where a font the import could not carry really comes from. The import
 * knows only that `--font-sans` is set by nobody it read; the app's layout
 * says which family that is, and with it the call that finishes the job.
 */
function withFontLoaders(
  notImported: NotImported[],
  hostRoot: string | null,
  stacks: Record<string, string>,
): unknown[] {
  return notImported.flatMap(({ font, ...entry }) => {
    const loader = font && hostRoot ? findFontLoader(hostRoot, font.cssVar) : null;
    if (!font || !loader) return [entry];
    if (!loader.family) {
      return [
        {
          ...entry,
          reason: `${font.cssVar} is set at runtime by next/font/local in ${loader.file} — a font file in the repo, with no family name to load. Declare it in the theme's customCss (@font-face), or name the closest family with set_theme { fonts }.`,
        },
      ];
    }
    // Already named, by an earlier run of this very hand-off: nothing is left behind.
    if (stacks[font.role]?.includes(loader.family)) return [];
    return [
      {
        ...entry,
        reason: `${font.cssVar} is set at runtime by next/font in ${loader.file} (${loader.family}), so no stylesheet names the family. Pass \`setTheme\` to set_theme.`,
        setTheme: {
          fonts: [
            {
              role: font.role,
              family: loader.family,
              // The weights the app asks for; for a variable face it asks for
              // none, and the catalogue knows the range (a bare load is regular only).
              google: loader.google ?? catalogFont(loader.family)?.google ?? true,
            },
          ],
        },
      },
    ];
  });
}

/** The app the imported stylesheet belongs to: the configured host, else the nearest package. */
async function importHostRoot(
  folder: DesignFolder,
  cssResolvedPath: string | undefined,
): Promise<string | null> {
  try {
    if (folder.config.hostApp?.root) return hostAppRootFrom(folder.root, folder.config.hostApp);
  } catch {
    // An `app:` root with no checkout bound here: fall through to the stylesheet's own tree.
  }
  if (!cssResolvedPath) return null;
  let dir = dirname(cssResolvedPath);
  for (let i = 0; i < 6; i++) {
    if ((await readFile(join(dir, "package.json"), "utf8").catch(() => null)) !== null) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * What to say about the app's charts. A chart library in package.json is not
 * a chart on a page: the hint is for an app that draws with one, and then it
 * points at the components that do — which the app's catalog already holds.
 */
async function chartAdvice(
  repo: MutationContext["repo"] | undefined,
  libs: string[],
): Promise<{ detectedChartLibs: string[]; chartHint: string } | null> {
  if (libs.length === 0) return null;
  const catalog = repo ? await repo.catalog().catch(() => null) : null;
  if (!catalog) {
    return {
      detectedChartLibs: libs,
      chartHint:
        'this app depends on a client chart library — if it draws charts with it, register those components as render:"live" extensions (add_extension) so the canvas preview AND emitted code use the app\'s real charts; the built-in Chart previews via echarts and will not pixel-match.',
    };
  }
  const drawn = libs.filter((lib) =>
    catalog.entries.some(
      (entry) =>
        entry.source === "package" &&
        (entry.packageName === lib || entry.packageName?.startsWith(`${lib}/`)),
    ),
  );
  if (drawn.length === 0) return null;
  return {
    detectedChartLibs: drawn,
    chartHint:
      'this app draws its charts with a client chart library, in components of its own: they are on list_components\' Repo shelves and mount for real, so compose those. Register one as a render:"live" extension (add_extension) only if component_status reports it unavailable; the built-in Chart previews via echarts and will not pixel-match.',
  };
}

export function registerThemeTools(
  mcp: McpServer,
  ctx: ThemeContext & { repo?: MutationContext["repo"] },
): void {
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
                .union([z.string(), z.boolean()])
                .optional()
                // `false` is how a caller says "a system font, load nothing".
                .transform((value) => (value === false ? undefined : value))
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
        if (Object.keys(r.value.readAs).length > 0) {
          // Named so the next call writes the path that was used — and so a
          // colour filed under `palette` isn't expected to flip in dark mode.
          applied.readAs = r.value.readAs;
        }
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
        // A family nothing loads renders as its fallback wherever the machine
        // lacks it, and the theme gives no sign: every text box a little off.
        const unloaded = args.fonts
          .filter((f) => f.family && !f.remove && !f.google && !catalogFont(f.family))
          .map((f) => f.family as string)
          .filter((family) => !SYSTEM_FAMILY.test(family));
        if (unloaded.length > 0) {
          applied.fontsNotLoaded = `Nothing loads ${unloaded.map((f) => `"${f}"`).join(", ")}: declared without \`google\` and not in velloo's font catalogue, so the canvas shows the fallback unless the machine has it. If it is a Google font, declare it with \`google: true\`; if the app ships the file, load it with \`customCss\` (@font-face).`;
        }
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
        name: z
          .string()
          .describe('Letters, digits, spaces, - and _ ("Night", "Brand B"); not \'default\''),
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
        renameTo: z.string().describe("New name — same rules as add_theme's"),
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
        "Code-to-design: seed the theme from an app's stylesheet — semantic slots, the raw `palette.*` passthrough for brand vars, fonts, radius, and the nearby tailwind.config's `theme.extend` — or from a DESIGN.md (`designMdPath`). Dry-run by default; pass `apply: true` to persist. Run this BEFORE porting screens. Guide: velloo://guide/theme.",
      inputSchema: {
        css: z.string().optional().describe("Stylesheet text (use this OR cssPath)"),
        designMd: z.string().optional().describe("DESIGN.md text (use this OR designMdPath)"),
        designMdPath: z
          .string()
          .optional()
          .describe("Path to a DESIGN.md, absolute or host-app-relative"),
        mode: z
          .enum(["light", "dark"])
          .optional()
          .describe("DESIGN.md only: which palette it becomes. Default light."),
        cssPath: z
          .string()
          .optional()
          .describe("Path to the stylesheet — absolute, or relative to the host app root"),
        theme: z.string().optional().describe('Named theme to merge into; default "default"'),
        apply: z.boolean().optional().describe("Persist the merge (default false = dry-run)"),
        tailwindConfigPath: z
          .string()
          .optional()
          .describe("Path to the app's tailwind.config; auto-detected near `cssPath` when omitted"),
      },
    },
    async (args) => {
      // Treat an empty/whitespace `css` as not-provided (agents sometimes pass css:"" + cssPath).
      let css: string | undefined = args.css?.trim() ? args.css : undefined;
      let cssResolvedPath: string | undefined;
      let expanded: ExpandedStylesheet | undefined;
      const designMd: string | undefined = args.designMd?.trim() ? args.designMd : undefined;
      const wantsDesignMd = designMd !== undefined || args.designMdPath !== undefined;
      if (wantsDesignMd) {
        if (css !== undefined || args.cssPath !== undefined) {
          return errorResult({
            kind: "BadRequest",
            message:
              "pass a stylesheet OR a DESIGN.md, not both — they are separate sources of truth. Import one, review the result, then import the other if you really want to layer them.",
          });
        }
        return importDesignMdResult(ctx, args, designMd);
      }
      if (css === undefined) {
        if (args.cssPath === undefined) {
          return errorResult({
            kind: "BadRequest",
            message: "pass either `css` text, a `cssPath`, or a `designMdPath`",
          });
        }
        const read = await readAppFile(ctx, args.cssPath);
        if ("tried" in read) {
          return errorResult({
            kind: "BadRequest",
            message:
              `could not read "${args.cssPath}" — tried ${triedList(read.tried)}. ` +
              `The host app's globals.css usually lives OUTSIDE the design folder (the design folder is at <appRoot>/velloo). ` +
              `Pass an absolute path, a path relative to the host app root, or paste the stylesheet text directly as \`css\`.`,
          });
        }
        cssResolvedPath = read.path;
        // The file an app points at is often only an entry point whose tokens
        // sit in a sheet it imports; read those as part of it.
        expanded = expandStylesheetImports(read.path, {
          root: importRootFor(ctx.folder, read.path),
          css: read.text,
        });
        css = expanded.css;
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
      const skippedNotes = expanded ? skippedImportNotes(expanded) : [];
      if (!r.ok) {
        return errorResult(
          r.error.kind === "BadRequest" && skippedNotes.length > 0
            ? { ...r.error, message: `${r.error.message}. ${skippedNotes.join(". ")}` }
            : r.error,
        );
      }
      const { changes, coverage, applied } = r.value;
      const warnings = [...r.value.warnings, ...skippedNotes];
      const container = detectContainer(tailwindConfig);
      const charts = await chartAdvice(
        ctx.repo,
        await detectChartLibs(ctx.folder, cssResolvedPath),
      );
      const notImported = withFontLoaders(
        r.value.notImported,
        await importHostRoot(ctx.folder, cssResolvedPath),
        r.value.theme.typography.fontFamily ?? {},
      );
      return jsonResult({
        applied,
        changeCount: changes.length,
        // A change count alone cannot distinguish a clean shadcn import from an
        // app whose vars matched nothing and parked everything in `palette.*`.
        coverage: {
          ...coverage,
          summary: `${coverage.semantic} of ${coverage.semanticTotal} semantic slots mapped; ${coverage.palette} palette passthrough`,
        },
        changes,
        // What the app states that did not reach the theme. Empty means the
        // import left nothing it saw behind — not that the theme is the app's.
        notImported,
        warnings,
        ...(expanded && expanded.followed.length > 0
          ? { importedStylesheets: [cssResolvedPath, ...expanded.followed] }
          : {}),
        ...(container ? { container } : {}),
        ...(charts ?? {}),
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
