import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CodegenError, emitCode, emitTheme } from "@velloo/codegen";
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
      const result = await emitCode(page, {
        variantId: args.variantId,
        outputPath: out,
        apply: args.apply ?? false,
        componentsAlias: args.componentsAlias ?? ctx.folder.config.codegen?.componentsAlias,
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
