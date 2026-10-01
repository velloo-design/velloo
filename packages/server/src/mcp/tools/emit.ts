import { isAbsolute, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  classNamesInJsx,
  detectTailwindMajor,
  type EmitThemeFile,
  emitCode,
  emitCssVariables,
  emitHtml,
  emitHtmlSnippet,
  emitNativeTheme,
  emitSnippet,
  emitTheme,
  type HostTailwindAdvisory,
  hostTailwindAdvisory,
} from "@velloo/codegen";
import { type FrameworkAdapter, styleChannelOf, type ThemeModuleSpec } from "@velloo/provider";
import type { Theme } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import { hostAppRootFrom } from "../../live/bundle-core.ts";
import { screenNotFound, snippetNotFound } from "../../mutations/errors.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { emitFrameworkContext, registryForScreen } from "../../mutations/lookup.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { emitDesignMdPair } from "../../theme/emit-design-md.ts";
import { diagnosticsForScreen, diagnosticsForTree } from "../diagnostics.ts";
import { EmitCodeOutput } from "./outputs.ts";
import { errorResult, jsonResult, structuredResult } from "./result.ts";

/**
 * What a Tailwind-channel emit must tell the agent about the host app: v4→v3
 * renames (the canvas compiles v4) and typeset utilities the app never got
 * from `emit_theme`. The design folder is left out of the stylesheet scan —
 * its CSS is the canvas's, not the app's.
 */
function hostAdvisoryFor(ctx: MutationContext, classes: string[]): HostTailwindAdvisory {
  const hostRoot = hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp);
  return hostTailwindAdvisory(hostRoot, classes, [ctx.folder.root]);
}

/** Merge a host advisory into an emit result's `warnings` + `tailwindV3Compat`. */
function withAdvisory<T extends { warnings: string[] }>(
  ir: T,
  advisory: HostTailwindAdvisory | null,
): T & { tailwindV3Compat?: HostTailwindAdvisory["v3Compat"] } {
  if (!advisory) return ir;
  return {
    ...ir,
    warnings: [...ir.warnings, ...advisory.warnings],
    ...(advisory.v3Compat.length > 0 ? { tailwindV3Compat: advisory.v3Compat } : {}),
  };
}

/**
 * One theme artifact a folder owes, resolved per *source* of components rather
 * than per folder: the adapter projects its own native theme (MUI ⇒
 * `createTheme`), and so does every framework recipe whose library a host app
 * has installed. Both can hold at once — a Mantine app in a MUI folder renders
 * both libraries on one screen — so `emit_theme` writes each one, instead of
 * choosing a single framework for the whole folder.
 */
interface NativeThemeSource {
  id: string;
  spec: ThemeModuleSpec;
  project(dark: boolean): unknown;
  /** Wiring the agent would otherwise have to infer; the adapter's own needs none. */
  note?: (path: string) => string;
}

function nativeThemeSources(
  ctx: MutationContext,
  adapter: FrameworkAdapter,
  theme: Theme,
): NativeThemeSource[] {
  const out: NativeThemeSource[] = [];
  const { themeToNative, themeModule } = adapter;
  if (themeToNative && themeModule) {
    out.push({
      id: adapter.id,
      spec: themeModule,
      project: (dark) => themeToNative.call(adapter, theme, dark),
    });
  }
  for (const recipe of ctx.repo?.allRecipes() ?? []) {
    out.push({
      id: recipe.id,
      spec: recipe.themeModule,
      project: (dark) => recipe.themeToNative(theme, dark),
      note: (path) =>
        `${recipe.label} components render from the app's own install, so their theme is emitted as ${recipe.label}'s own theme module (${path}); pass it to the app's provider.`,
    });
  }
  return out;
}

/** `theme.ts` → `theme-mantine.ts`: two native modules must not share a path. */
function qualifyThemePath(path: string, id: string): string {
  const dot = path.lastIndexOf(".");
  return dot > Math.max(path.lastIndexOf("/"), path.lastIndexOf(sep))
    ? `${path.slice(0, dot)}-${id}${path.slice(dot)}`
    : `${path}-${id}`;
}

export function registerEmitTools(mcp: McpServer, ctx: MutationContext, jit?: TailwindJit): void {
  mcp.registerTool(
    "emit_code",
    {
      description:
        "Return agent-consumed IR for a screen plus full class/theme diagnostics: the JSX body in the screen framework's native idiom (Tailwind classes for shadcn, `sx={{…}}` for MUI, HTML for htmx), plus the components, icons, snippets and classes used. **Not** a paste-ready file — no imports, no prettier pass. Read it and write the real code in the user's app conventions.",
      outputSchema: EmitCodeOutput,
      inputSchema: {
        screenId: z.string(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const screen = ctx.folder.screens.get(args.screenId);
      if (!screen) return errorResult(screenNotFound(args.screenId));
      const componentsAlias = args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias;
      const framework = await emitFrameworkContext(ctx, screen);
      if (framework.html) {
        const [result, diagnostics] = await Promise.all([
          emitHtml(screen, {
            registry: registryForScreen(ctx, screen),
            snippets: ctx.folder.snippets,
          }),
          diagnosticsForScreen(ctx, jit, screen).catch(() => []),
        ]);
        return structuredResult({
          ...result,
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        });
      }
      const result = await emitCode(screen, {
        ...(componentsAlias ? { componentsAlias } : {}),
        snippets: ctx.folder.snippets,
        extensions: ctx.folder.config.extensions,
        ...framework.emit,
      });
      if (!result.ok) return errorResult(result.error);
      // Snippet bodies are separate IRs, so their classes aren't in the
      // screen's classesUsed — pull them from the emitted JSX.
      const advisory = framework.tailwind
        ? hostAdvisoryFor(ctx, [
            ...result.value.classesUsed,
            ...result.value.snippetsUsed.flatMap((s) => classNamesInJsx(s.jsx)),
          ])
        : null;
      const diagnostics = await diagnosticsForScreen(ctx, jit, screen).catch(() => []);
      return structuredResult({
        ...withAdvisory(result.value, advisory),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    },
  );

  mcp.registerTool(
    "emit_snippet",
    {
      description:
        "Return agent-consumed IR for a single snippet: PascalCase component name, typed params, body (JSX, or HTML with `$name` markers).",
      inputSchema: {
        snippetId: z.string(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const snippet = ctx.folder.snippets.get(args.snippetId);
      if (!snippet) return errorResult(snippetNotFound(args.snippetId));
      const framework = await emitFrameworkContext(ctx, snippet);
      if (framework.html) {
        const [result, diagnostics] = await Promise.all([
          emitHtmlSnippet(snippet, {
            registry: registryForScreen(ctx, snippet),
            snippets: ctx.folder.snippets,
          }),
          diagnosticsForTree(ctx, jit, snippet, snippet.tree).catch(() => []),
        ]);
        return structuredResult({
          ...result,
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        });
      }
      const componentsAlias = args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias;
      const result = await emitSnippet(snippet, {
        ...(componentsAlias ? { componentsAlias } : {}),
        snippets: ctx.folder.snippets,
        extensions: ctx.folder.config.extensions,
        ...framework.emit,
      });
      if (!result.ok) return errorResult(result.error);
      const advisory = framework.tailwind
        ? hostAdvisoryFor(ctx, classNamesInJsx(result.value.jsx))
        : null;
      const diagnostics = await diagnosticsForTree(ctx, jit, snippet, snippet.tree).catch(() => []);
      return structuredResult({
        ...withAdvisory(result.value, advisory),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    },
  );

  mcp.registerTool(
    "emit_theme",
    {
      description:
        "Write the theme artifacts this design's components need — shadcn ⇒ Tailwind globals.css, native frameworks ⇒ their own theme module, none ⇒ CSS variables, and one module per library the app's own components come from — plus a framework-neutral DTCG `tokens.json`. Dry-run by default. These are finished artifacts, not IR: no agent translation, and the result's `notes` carry any one-time wiring steps. Guide: velloo://guide/theme.",
      inputSchema: {
        outputDir: z.string(),
        cssPath: z
          .string()
          .optional()
          .describe(
            'Stylesheet path relative to outputDir; default "app/globals.css" or "velloo-theme.css"',
          ),
        themePath: z
          .string()
          .optional()
          .describe(
            'Native theme module location relative to outputDir; default "theme.ts". A second module is suffixed with its library (theme-mantine.ts)',
          ),
        apply: z.boolean().optional(),
        cssOnly: z.boolean().optional(),
        theme: z.string().optional().describe("Named theme to emit; default 'default'"),
        format: z
          .enum(["framework", "design-md"])
          .optional()
          .describe(
            '"design-md" writes a Google Labs DESIGN.md instead of the framework artifacts',
          ),
        tailwind: z
          .union([z.literal(3), z.literal(4)])
          .optional()
          .describe(
            "Force the Tailwind major of the emitted artifacts; default: detected from outputDir's package.json",
          ),
      },
    },
    async (args) => {
      const out = resolve(ctx.folder.root, args.outputDir);
      // `apply:true` writes to disk; a relative cssPath/themePath must stay
      // inside outputDir (no `..`/absolute escape to clobber arbitrary files).
      for (const rel of [args.cssPath, args.themePath]) {
        if (rel === undefined) continue;
        if (isAbsolute(rel) || !resolve(out, rel).startsWith(out + sep)) {
          return errorResult(`emit_theme: path must stay within outputDir (got ${rel})`);
        }
      }
      const theme = themeByName(ctx.folder, args.theme);
      if (args.format === "design-md") {
        const { files, warnings, notes } = await emitDesignMdPair(ctx.folder, theme, {
          outputDir: out,
          apply: args.apply ?? false,
        });
        return jsonResult({ files, ...(warnings.length > 0 ? { warnings } : {}), notes });
      }
      const adapter = ctx.defaultProvider as FrameworkAdapter;
      const files: EmitThemeFile[] = [];
      const warnings: string[] = [];
      const notes: string[] = [];
      // A framework that projects a native theme module (MUI ⇒ createTheme
      // options) writes it instead of a stylesheet; the module shape comes from
      // the source, so no framework is special-cased here.
      const native = nativeThemeSources(ctx, adapter, theme);
      const adapterIsNative =
        adapter.themeToNative !== undefined && adapter.themeModule !== undefined;
      for (const [index, source] of native.entries()) {
        // The first module keeps the requested path; the rest qualify by source
        // id, so two `createTheme` modules can't land on one `theme.ts`.
        const wanted = args.themePath ?? source.spec.defaultPath;
        const themePath = index === 0 ? wanted : qualifyThemePath(wanted, source.id);
        const result = await emitNativeTheme(source.project(false), {
          spec: source.spec,
          outputDir: out,
          themePath,
          ...(theme.colorsDark ? { darkThemeOptions: source.project(true) } : {}),
          // tokens.json once — the stylesheet artifact below writes it too.
          ...(index === 0 && adapterIsNative ? { sourceTheme: theme } : {}),
          apply: args.apply ?? false,
        });
        files.push(...result.files);
        warnings.push(...result.warnings);
        if (source.note) notes.push(source.note(themePath));
      }
      // The adapter's own artifact when it has no native module: CSS variables
      // for the inline `style` channel (emitted markup carries `var(--…)`
      // references, so the app needs the variables themselves), else Tailwind.
      if (!adapterIsNative) {
        const result = await (args.tailwind === undefined &&
        styleChannelOf(adapter, ctx.folder.config.styling?.framework).kind === "style"
          ? emitCssVariables(theme, {
              outputDir: out,
              ...(args.cssPath ? { cssPath: args.cssPath } : {}),
              customCss: ctx.folder.customCss,
              apply: args.apply ?? false,
            })
          : emitTheme(theme, {
              outputDir: out,
              ...(args.cssPath ? { cssPath: args.cssPath } : {}),
              apply: args.apply ?? false,
              cssOnly: args.cssOnly,
              customCss: ctx.folder.customCss,
              ...((args.tailwind ?? detectTailwindMajor(out)) === 3
                ? { tailwindMajor: 3 as const }
                : {}),
            }));
        files.push(...result.files);
        warnings.push(...result.warnings);
        notes.push(...result.notes);
      }
      return jsonResult({
        files,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      });
    },
  );
}
