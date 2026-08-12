import { resolve } from "node:path";
import { emitCode, emitTheme, UnknownComponentError, VariantNotFoundError } from "@velloo/codegen";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";

function badRequest(reason: string) {
  return { error: { code: "BAD_REQUEST", message: reason } };
}

export function createEmitRouter(folderFor: () => DesignFolder): Hono {
  const r = new Hono();

  r.post("/code", async (c) => {
    const args = (await c.req.json()) as {
      pageId?: string;
      variantId?: string;
      outputPath?: string;
      apply?: boolean;
      componentsAlias?: string;
    };
    if (!args.pageId || !args.variantId || !args.outputPath) {
      return c.json(badRequest("pageId, variantId, and outputPath are required"), 400);
    }
    const folder = folderFor();
    const page = folder.pages.get(args.pageId);
    if (!page) {
      return c.json(
        { error: { code: "NOT_FOUND", message: `Unknown pageId: ${args.pageId}` } },
        404,
      );
    }
    const out = resolve(folder.root, args.outputPath);
    try {
      const result = await emitCode(page, {
        variantId: args.variantId,
        outputPath: out,
        apply: args.apply ?? false,
        componentsAlias: args.componentsAlias,
      });
      return c.json({
        wouldWriteTo: out,
        applied: result.applied,
        diff: result.diff,
        errors: result.errors,
        code: result.code,
      });
    } catch (err) {
      if (err instanceof VariantNotFoundError) {
        return c.json({ error: { code: "NOT_FOUND", message: err.message } }, 404);
      }
      if (err instanceof UnknownComponentError) {
        return c.json({ error: { code: "BAD_REQUEST", message: err.message } }, 400);
      }
      throw err;
    }
  });

  r.post("/theme", async (c) => {
    const args = (await c.req.json()) as {
      outputDir?: string;
      apply?: boolean;
      cssOnly?: boolean;
    };
    if (!args.outputDir) return c.json(badRequest("outputDir is required"), 400);
    const folder = folderFor();
    const out = resolve(folder.root, args.outputDir);
    const result = await emitTheme(folder.theme, {
      outputDir: out,
      apply: args.apply ?? false,
      cssOnly: args.cssOnly,
    });
    return c.json({ files: result.files });
  });

  return r;
}
