import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { emitCode, emitTheme, UnknownComponentError, VariantNotFoundError } from "@velloo/codegen";
import { z } from "zod";
import type { DesignFolder } from "../../design-folder.ts";

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function errorResult(err: unknown): {
  isError: true;
  content: { type: "text"; text: string }[];
} {
  return { isError: true, content: [{ type: "text", text: String(err) }] };
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
      try {
        const page = ctx.folder.pages.get(args.pageId);
        if (!page) {
          return errorResult(new Error(`Unknown pageId: ${JSON.stringify(args.pageId)}`));
        }
        const out = resolve(ctx.folder.root, args.outputPath);
        const result = await emitCode(page, {
          variantId: args.variantId,
          outputPath: out,
          apply: args.apply ?? false,
          componentsAlias: args.componentsAlias,
        });
        return jsonResult({
          wouldWriteTo: out,
          applied: result.applied,
          diff: result.diff,
          errors: result.errors,
          code: result.code,
        });
      } catch (err) {
        if (err instanceof VariantNotFoundError || err instanceof UnknownComponentError) {
          return errorResult(err);
        }
        return errorResult(err);
      }
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
      try {
        const out = resolve(ctx.folder.root, args.outputDir);
        const result = await emitTheme(ctx.folder.theme, {
          outputDir: out,
          apply: args.apply ?? false,
          cssOnly: args.cssOnly,
        });
        return jsonResult({ files: result.files });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
