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
        "Generate idiomatic shadcn .tsx for one variant of a page. By default returns a unified diff against the destination without writing; pass apply=true to actually write the file. outputPath is resolved relative to the design folder if not absolute.",
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        outputPath: z.string(),
        apply: z.boolean().optional(),
        componentsAlias: z.string().optional(),
      },
    },
    async (args) => {
      const page = ctx.folder.pages.get(args.pageId);
      if (!page) return codegenErrorResult({ kind: "PageNotFound", pageId: args.pageId } as never);
      const out = resolve(ctx.folder.root, args.outputPath);
      const componentsAlias = args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias;
      const result = await emitCode(page, {
        variantId: args.variantId,
        outputPath: out,
        apply: args.apply ?? false,
        componentsAlias,
        snippets: ctx.folder.snippets,
      });
      if (!result.ok) return codegenErrorResult(result.error);

      // Emit each referenced snippet alongside the page so the import path
      // resolves on the user's side.
      const usedSnippets = snippetIdsReferenced(page);
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
        "Generate a React component for one snippet. Useful for emitting snippets that no page yet references. outputPath is resolved relative to the design folder.",
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
        "Generate Tailwind v4 globals.css (and optional tailwind.config.ts) from the active theme. Defaults to dry-run: returns diffs without writing. outputDir is resolved relative to the design folder if not absolute.",
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
