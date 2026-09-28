import { isAbsolute, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CodegenTarget,
  classNamesInJsx,
  detectTailwindMajor,
  emitCode,
  emitCssVariables,
  emitHtml,
  emitHtmlSnippet,
  emitNativeTheme,
  emitSnippet,
  emitTheme,
  moduleTarget,
  type V3ClassIssue,
  v3ClassIssues,
} from "@velloo/codegen";
import { type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import type { Screen, Snippet } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import { hostAppRootFrom } from "../../live/bundle-core.ts";
import { screenNotFound, snippetNotFound } from "../../mutations/errors.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { providerForScreen, registryForScreen } from "../../mutations/lookup.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { emitDesignMdPair } from "../../theme/emit-design-md.ts";
import { diagnosticsForScreen, diagnosticsForTree } from "../diagnostics.ts";
import { EmitCodeOutput } from "./outputs.ts";
import { errorResult, jsonResult, structuredResult } from "./result.ts";

/**
 * v4→v3 class advisory for a Tailwind-channel emit when the host app is still
 * on Tailwind v3: the canvas compiles v4, so design classes carry v4 semantics
 * and some need renaming (or have no v3 equivalent) in the file the agent
 * writes. Empty when the host is v4/unknown or nothing needs attention.
 */
function v3CompatFor(ctx: MutationContext, classes: string[]): V3ClassIssue[] {
  const hostRoot = hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp);
  if (detectTailwindMajor(hostRoot) !== 3) return [];
  return v3ClassIssues(classes);
}

/**
 * The codegen target for a screen/snippet's framework: when its provider
 * declares a `codegenModule` (MUI ⇒ `@mui/material`), emit resolves that
 * library's component ids to native imports from the module and skips shadcn
 * lowering. shadcn/no-lib providers have no module ⇒ undefined ⇒ today's path.
 */
async function targetFor(
  ctx: MutationContext,
  thing: Pick<Screen, "library"> | Pick<Snippet, "library">,
): Promise<CodegenTarget | undefined> {
  const provider = providerForScreen(ctx, thing) as FrameworkAdapter;
  if (!provider.codegenModule) return undefined;
  const manifest = await provider.loadManifest();
  // Only the framework's OWN components import from its module — the reused
  // velloo helpers (Icon, Image, …; source "velloo") fall through to the shadcn
  // REGISTRY so `Icon` emits a lucide-react import, not `@mui/material`.
  return moduleTarget(
    manifest.filter((c) => c.source !== "velloo").map((c) => c.id),
    provider.codegenModule,
  );
}

/**
 * Whether a screen/snippet emits on the inline-`style` channel (a none/none
 * folder). When true, emit_code lowers the no-lib primitives to plain HTML with
 * inline `style` defaults — Tailwind-free — instead of className lowering.
 */
function isInlineStyle(
  ctx: MutationContext,
  thing: Pick<Screen, "library"> | Pick<Snippet, "library">,
): boolean {
  return (
    styleChannelOf(providerForScreen(ctx, thing), ctx.folder.config.styling?.framework).kind ===
    "style"
  );
}

/** Whether the screen/snippet's adapter emits native HTML rather than JSX. */
function emitsHtml(
  ctx: MutationContext,
  thing: Pick<Screen, "library"> | Pick<Snippet, "library">,
): boolean {
  return (providerForScreen(ctx, thing) as FrameworkAdapter).codegenFormat === "html";
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
      const target = await targetFor(ctx, screen);
      const inlineStyle = isInlineStyle(ctx, screen);
      if (emitsHtml(ctx, screen)) {
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
        ...(target ? { target } : {}),
        ...(inlineStyle ? { inlineStyle: true } : {}),
      });
      if (!result.ok) return errorResult(result.error);
      // Snippet bodies are separate IRs, so their classes aren't in the
      // screen's classesUsed — pull them from the emitted JSX.
      const compat =
        target || inlineStyle
          ? []
          : v3CompatFor(ctx, [
              ...result.value.classesUsed,
              ...result.value.snippetsUsed.flatMap((s) => classNamesInJsx(s.jsx)),
            ]);
      const diagnostics = await diagnosticsForScreen(ctx, jit, screen).catch(() => []);
      return structuredResult({
        ...result.value,
        ...(compat.length > 0 ? { tailwindV3Compat: compat } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    },
  );

  mcp.registerTool(
    "emit_snippet",
    {
      description:
        "Return agent-consumed IR for a single snippet: PascalCase component name, typed params, JSX body (htmx: HTML with `$name` markers).",
      inputSchema: {
        snippetId: z.string(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const snippet = ctx.folder.snippets.get(args.snippetId);
      if (!snippet) return errorResult(snippetNotFound(args.snippetId));
      if (emitsHtml(ctx, snippet)) {
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
      const target = await targetFor(ctx, snippet);
      const inlineStyle = isInlineStyle(ctx, snippet);
      const result = await emitSnippet(snippet, {
        ...(componentsAlias ? { componentsAlias } : {}),
        snippets: ctx.folder.snippets,
        extensions: ctx.folder.config.extensions,
        ...(target ? { target } : {}),
        ...(inlineStyle ? { inlineStyle: true } : {}),
      });
      if (!result.ok) return errorResult(result.error);
      const compat =
        target || inlineStyle ? [] : v3CompatFor(ctx, classNamesInJsx(result.value.jsx));
      const diagnostics = await diagnosticsForTree(ctx, jit, snippet, snippet.tree).catch(() => []);
      return structuredResult({
        ...result.value,
        ...(compat.length > 0 ? { tailwindV3Compat: compat } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    },
  );

  mcp.registerTool(
    "emit_theme",
    {
      description:
        "Write the active framework's theme artifact — shadcn ⇒ Tailwind globals.css, native frameworks ⇒ their own theme module, no CSS framework ⇒ CSS variables — plus a framework-neutral DTCG `tokens.json`. Dry-run by default. These are finished artifacts, not IR: no agent translation, and the result's `notes` carry any one-time wiring steps. Guide: velloo://guide/theme.",
      inputSchema: {
        outputDir: z.string(),
        cssPath: z
          .string()
          .optional()
          .describe(
            'Stylesheet path relative to outputDir; default "app/globals.css" (no CSS framework: "velloo-theme.css")',
          ),
        themePath: z
          .string()
          .optional()
          .describe('MUI: createTheme module location relative to outputDir; default "theme.ts"'),
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
      // A framework that projects a native theme (MUI ⇒ createTheme options)
      // emits its native artifact instead of Tailwind globals.css. The module
      // shape comes from the adapter, so no framework is special-cased here.
      const adapter = ctx.defaultProvider as FrameworkAdapter;
      if (adapter.themeToNative && adapter.themeModule) {
        const result = await emitNativeTheme(adapter.themeToNative(theme), {
          spec: adapter.themeModule,
          outputDir: out,
          ...(args.themePath ? { themePath: args.themePath } : {}),
          ...(theme.colorsDark ? { darkThemeOptions: adapter.themeToNative(theme, true) } : {}),
          sourceTheme: theme,
          apply: args.apply ?? false,
        });
        return jsonResult({ files: result.files });
      }
      // No adapter owns the app's framework, but a recipe for it does (a
      // Mantine app on the no-framework adapter): its components are styled by
      // that framework's theme, so emit that — Tailwind files would restyle
      // nothing in an app that doesn't use Tailwind.
      const recipe = ctx.repo?.recipes(undefined)[0];
      if (recipe && adapter.id === "none") {
        const result = await emitNativeTheme(recipe.themeToNative(theme, false), {
          spec: recipe.themeModule,
          outputDir: out,
          ...(args.themePath ? { themePath: args.themePath } : {}),
          ...(theme.colorsDark ? { darkThemeOptions: recipe.themeToNative(theme, true) } : {}),
          sourceTheme: theme,
          apply: args.apply ?? false,
        });
        return jsonResult({
          files: result.files,
          notes: [
            `This app's components are ${recipe.label}, so the theme is emitted as ${recipe.label}'s own theme module; pass it to the app's provider.`,
          ],
        });
      }
      // No CSS framework (inline `style` channel): emitted markup carries
      // `var(--…)` references, so the app needs the variables themselves.
      if (
        args.tailwind === undefined &&
        styleChannelOf(adapter, ctx.folder.config.styling?.framework).kind === "style"
      ) {
        const result = await emitCssVariables(theme, {
          outputDir: out,
          ...(args.cssPath ? { cssPath: args.cssPath } : {}),
          customCss: ctx.folder.customCss,
          apply: args.apply ?? false,
        });
        return jsonResult({
          files: result.files,
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
          notes: result.notes,
        });
      }
      const tailwindMajor = args.tailwind ?? detectTailwindMajor(out);
      const result = await emitTheme(theme, {
        outputDir: out,
        ...(args.cssPath ? { cssPath: args.cssPath } : {}),
        apply: args.apply ?? false,
        cssOnly: args.cssOnly,
        customCss: ctx.folder.customCss,
        ...(tailwindMajor === 3 ? { tailwindMajor: 3 as const } : {}),
      });
      return jsonResult({
        files: result.files,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        ...(result.notes.length > 0 ? { notes: result.notes } : {}),
      });
    },
  );
}
