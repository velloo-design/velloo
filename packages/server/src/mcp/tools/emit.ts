import { dirname, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CodegenError,
  type EmitCodeResult,
  emitCode,
  emitSnippet,
  emitTheme,
  snippetIdsReferenced,
} from "@velloo/codegen";
import { z } from "zod";
import type { DesignFolder } from "../../design-folder.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function codegenErrorResult(error: CodegenError | { kind: string }): McpResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] };
}

export interface EmitContext {
  folder: DesignFolder;
}

function pascalCase(input: string): string {
  return (
    input
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "Snippet"
  );
}

export function registerEmitTools(mcp: McpServer, ctx: EmitContext): void {
  mcp.registerTool(
    "emit_code",
    {
      description:
        "Generate JSX-shaped code for a screen, intended for the agent to read and translate into the user's app code. Default returns a unified diff; pass apply=true to write. outputPath is resolved relative to the design folder if not absolute.",
      inputSchema: {
        screenId: z.string(),
        outputPath: z.string(),
        apply: z.boolean().optional(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const screen = ctx.folder.screens.get(args.screenId);
      if (!screen)
        return codegenErrorResult({ kind: "ScreenNotFound", screenId: args.screenId } as never);
      const out = resolve(ctx.folder.root, args.outputPath);
      const componentsAlias = args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias;
      const result = await emitCode(screen, {
        outputPath: out,
        apply: args.apply ?? false,
        componentsAlias,
        snippets: ctx.folder.snippets,
      });
      if (!result.ok) return codegenErrorResult(result.error);

      const usedSnippets = snippetIdsReferenced(screen);
      const snippetFiles: { snippetId: string; outputPath: string; result: EmitCodeResult }[] = [];
      const baseDir = dirname(out);
      for (const id of usedSnippets) {
        const snippet = ctx.folder.snippets.get(id);
        if (!snippet) continue;
        const snippetOut = join(baseDir, "..", "snippets", `${pascalCase(snippet.name || id)}.tsx`);
        const r = await emitSnippet(snippet, {
          outputPath: resolve(snippetOut),
          apply: args.apply ?? false,
          componentsAlias,
          snippets: ctx.folder.snippets,
        });
        if (!r.ok) return codegenErrorResult(r.error);
        snippetFiles.push({ snippetId: id, outputPath: resolve(snippetOut), result: r.value });
      }

      return jsonResult({
        wouldWriteTo: out,
        applied: result.value.applied,
        diff: result.value.diff,
        errors: result.value.errors,
        code: result.value.code,
        snippets: snippetFiles.map((s) => ({
          snippetId: s.snippetId,
          outputPath: s.outputPath,
          applied: s.result.applied,
          diff: s.result.diff,
          errors: s.result.errors,
        })),
      });
    },
  );

  mcp.registerTool(
    "emit_snippet",
    {
      description:
        "Generate a React component for one snippet. Useful for emitting snippets no screen yet references. outputPath is resolved relative to the design folder.",
      inputSchema: {
        snippetId: z.string(),
        outputPath: z.string(),
        apply: z.boolean().optional(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const snippet = ctx.folder.snippets.get(args.snippetId);
      if (!snippet)
        return codegenErrorResult({ kind: "SnippetNotFound", snippetId: args.snippetId } as never);
      const out = resolve(ctx.folder.root, args.outputPath);
      const result = await emitSnippet(snippet, {
        outputPath: out,
        apply: args.apply ?? false,
        componentsAlias: args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias,
        snippets: ctx.folder.snippets,
      });
      if (!result.ok) return codegenErrorResult(result.error);
      return jsonResult({
        wouldWriteTo: out,
        applied: result.value.applied,
        diff: result.value.diff,
        errors: result.value.errors,
        code: result.value.code,
      });
    },
  );

  mcp.registerTool(
    "emit_theme",
    {
      description:
        "Generate Tailwind v4 globals.css (and optional tailwind.config.ts) from the active theme. Defaults to dry-run.",
      inputSchema: {
        outputDir: z.string(),
        apply: z.boolean().optional(),
        cssOnly: z.boolean().optional(),
      },
    },
    async (args) => {
      const out = resolve(ctx.folder.root, args.outputDir);
      const result = await emitTheme(ctx.folder.theme, {
        outputDir: out,
        apply: args.apply ?? false,
        cssOnly: args.cssOnly,
      });
      return jsonResult({ files: result.files });
    },
  );
}
