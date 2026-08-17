import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CodegenError, emitCode, emitSnippet, emitTheme } from "@velloo/codegen";
import { z } from "zod";
import { type DesignFolder, themeByName } from "../../design-folder.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function codegenErrorResult(error: CodegenError | { kind: string }): McpResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] };
}

export interface EmitContext {
  folder: DesignFolder;
}

export function registerEmitTools(mcp: McpServer, ctx: EmitContext): void {
  mcp.registerTool(
    "emit_code",
    {
      description:
        "Return agent-consumed IR for a screen: the JSX body (using library identifiers + verbatim Tailwind classes), the list of components / icons / snippets / classes used. **Not** a paste-ready file — no imports, no prettier pass. The agent reads this and writes the real code in the user's app conventions.",
      inputSchema: {
        screenId: z.string(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const screen = ctx.folder.screens.get(args.screenId);
      if (!screen)
        return codegenErrorResult({ kind: "ScreenNotFound", screenId: args.screenId } as never);
      const componentsAlias = args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias;
      const result = await emitCode(screen, {
        ...(componentsAlias ? { componentsAlias } : {}),
        snippets: ctx.folder.snippets,
        extensions: ctx.folder.config.extensions,
      });
      if (!result.ok) return codegenErrorResult(result.error);
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
      if (!snippet)
        return codegenErrorResult({ kind: "SnippetNotFound", snippetId: args.snippetId } as never);
      const componentsAlias = args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias;
      const result = await emitSnippet(snippet, {
        ...(componentsAlias ? { componentsAlias } : {}),
        snippets: ctx.folder.snippets,
        extensions: ctx.folder.config.extensions,
      });
      if (!result.ok) return codegenErrorResult(result.error);
      return jsonResult(result.value);
    },
  );

  mcp.registerTool(
    "emit_theme",
    {
      description:
        "Generate Tailwind v4 globals.css (and optional tailwind.config.ts) from the active theme. Defaults to dry-run; this one *is* a direct artifact (no agent translation needed).",
      inputSchema: {
        outputDir: z.string(),
        apply: z.boolean().optional(),
        cssOnly: z.boolean().optional(),
        theme: z.string().optional().describe("Named theme to emit; default 'default'"),
      },
    },
    async (args) => {
      const out = resolve(ctx.folder.root, args.outputDir);
      const result = await emitTheme(themeByName(ctx.folder, args.theme), {
        outputDir: out,
        apply: args.apply ?? false,
        cssOnly: args.cssOnly,
        customCss: ctx.folder.customCss,
      });
      return jsonResult({ files: result.files });
    },
  );
}
