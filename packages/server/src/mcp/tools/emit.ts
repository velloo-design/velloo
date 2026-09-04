import { isAbsolute, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CodegenTarget,
  classNamesInJsx,
  detectTailwindMajor,
  emitCode,
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
import { providerForScreen } from "../../mutations/lookup.ts";
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

export function registerEmitTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "emit_code",
    {
      description:
        "Return agent-consumed IR for a screen: the JSX body in the screen framework's native idiom (Tailwind classes for shadcn, `sx={{…}}` for MUI), plus the components, icons, snippets and classes used. **Not** a paste-ready file — no imports, no prettier pass. Read it and write the real code in the user's app conventions.",
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
      return structuredResult(
        compat.length > 0 ? { ...result.value, tailwindV3Compat: compat } : { ...result.value },
      );
    },
  );

  mcp.registerTool(
    "emit_snippet",
    {
      description:
        "Return agent-consumed IR for a single snippet: PascalCase component name, typed params, JSX body.",
      inputSchema: {
        snippetId: z.string(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const snippet = ctx.folder.snippets.get(args.snippetId);
      if (!snippet) return errorResult(snippetNotFound(args.snippetId));
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
      return structuredResult(
        compat.length > 0 ? { ...result.value, tailwindV3Compat: compat } : { ...result.value },
      );
    },
  );

  mcp.registerTool(
    "emit_theme",
    {
      description:
        "Write the active framework's theme artifact — shadcn ⇒ Tailwind globals.css, native frameworks ⇒ their own theme module — plus a framework-neutral DTCG `tokens.json`. Dry-run by default. These are finished artifacts, not IR: no agent translation, and the result's `notes` carry any one-time wiring steps. Guide: velloo://guide/theme.",
      inputSchema: {
        outputDir: z.string(),
        cssPath: z
          .string()
          .optional()
          .describe(
            'shadcn: globals.css location relative to outputDir; default "app/globals.css"',
          ),
        themePath: z
          .string()
          .optional()
          .describe('MUI: createTheme module location relative to outputDir; default "theme.ts"'),
        apply: z.boolean().optional(),
        cssOnly: z.boolean().optional(),
        theme: z.string().optional().describe("Named theme to emit; default 'default'"),
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
