import { resolve } from "node:path";
import { emitCode, emitTheme } from "@velloo/codegen";
import { Hono } from "hono";
import { z } from "zod";
import type { DesignFolder } from "../design-folder.ts";
import { screenNotFound } from "../mutations/errors.ts";
import { codegenToHttp, mutationToHttp } from "./error-http.ts";

const EmitCodeBody = z.object({
  screenId: z.string().min(1),
  componentsAlias: z.string().min(1).optional(),
});

const EmitThemeBody = z.object({
  outputDir: z.string().min(1),
  apply: z.boolean().optional(),
  cssOnly: z.boolean().optional(),
});

export function createEmitRouter(folderFor: () => DesignFolder): Hono {
  const r = new Hono();

  r.post("/code", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = EmitCodeBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "BadRequest",
            message: "Request body failed validation.",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const args = parsed.data;
    const folder = folderFor();
    const screen = folder.screens.get(args.screenId);
    if (!screen) return mutationToHttp(c, screenNotFound(args.screenId));
    const componentsAlias = args.componentsAlias ?? folder.config.codegen?.componentsAlias;
    const result = await emitCode(screen, {
      ...(componentsAlias ? { componentsAlias } : {}),
      snippets: folder.snippets,
      extensions: folder.config.extensions,
    });
    if (!result.ok) return codegenToHttp(c, result.error);
    return c.json(result.value);
  });

  r.post("/theme", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = EmitThemeBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "BadRequest",
            message: "Request body failed validation.",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const args = parsed.data;
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
