import { isAbsolute, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CodegenTarget,
  emitCode,
  emitMuiTheme,
  emitSnippet,
  emitTheme,
  moduleTarget,
} from "@velloo/codegen";
import { type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import type { Screen, Snippet } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import { screenNotFound, snippetNotFound } from "../../mutations/errors.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { providerForScreen } from "../../mutations/lookup.ts";
import { errorResult, jsonResult } from "./result.ts";

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
        "Return agent-consumed IR for a screen: the JSX body (library identifiers + the screen framework's native styling — Tailwind classes for shadcn, `sx={{…}}` for MUI), plus the components / icons / snippets / classes used. **Not** a paste-ready file — no imports, no prettier pass. The agent reads this and writes the real code in the user's app conventions (for MUI, components import from `@mui/material`).",
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
      const result = await emitCode(screen, {
        ...(componentsAlias ? { componentsAlias } : {}),
        snippets: ctx.folder.snippets,
        extensions: ctx.folder.config.extensions,
        ...(target ? { target } : {}),
        ...(isInlineStyle(ctx, screen) ? { inlineStyle: true } : {}),
      });
      if (!result.ok) return errorResult(result.error);
      return jsonResult(result.value);
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
      const result = await emitSnippet(snippet, {
        ...(componentsAlias ? { componentsAlias } : {}),
        snippets: ctx.folder.snippets,
        extensions: ctx.folder.config.extensions,
        ...(target ? { target } : {}),
        ...(isInlineStyle(ctx, snippet) ? { inlineStyle: true } : {}),
      });
      if (!result.ok) return errorResult(result.error);
      return jsonResult(result.value);
    },
  );

  mcp.registerTool(
    "emit_theme",
    {
      description:
        "Generate the active framework's theme artifact from the active theme. shadcn ⇒ Tailwind v4 globals.css (+ optional tailwind.config.ts) at `<outputDir>/<cssPath>` (cssPath default `app/globals.css`; pass `globals.css`/`src/index.css` for Vite/Astro). MUI ⇒ a `createTheme(...)` module at `<outputDir>/<themePath>` (default `theme.ts`). Defaults to dry-run; this *is* a direct artifact (no agent translation needed).",
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
      // emits its native artifact instead of Tailwind globals.css.
      const adapter = ctx.defaultProvider as FrameworkAdapter;
      if (adapter.codegenModule && adapter.themeToNative) {
        const result = await emitMuiTheme(adapter.themeToNative(theme), {
          outputDir: out,
          ...(args.themePath ? { themePath: args.themePath } : {}),
          ...(theme.colorsDark ? { darkThemeOptions: adapter.themeToNative(theme, true) } : {}),
          apply: args.apply ?? false,
        });
        return jsonResult({ files: result.files });
      }
      const result = await emitTheme(theme, {
        outputDir: out,
        ...(args.cssPath ? { cssPath: args.cssPath } : {}),
        apply: args.apply ?? false,
        cssOnly: args.cssOnly,
        customCss: ctx.folder.customCss,
      });
      return jsonResult({
        files: result.files,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      });
    },
  );
}
