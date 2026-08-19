import { Hono } from "hono";
import { z } from "zod";
import type { DesignFolder } from "../design-folder.ts";
import { generateSvg } from "../generate/generate-svg.ts";

const SvgRequestSchema = z.object({
  prompt: z.string().min(1),
  filename: z.string().optional(),
  viewBox: z.string().optional(),
  color: z.string().optional(),
});

/**
 * HTTP wrapper around the SVG generator. Mirrors the MCP tool so the
 * canvas can wire a "Generate SVG…" button without going through the
 * MCP transport.
 */
export function createGenerateRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.post("/svg", async (c) => {
    const parsed = SvgRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { kind: "EmptyPrompt" } }, 400);
    const body = parsed.data;
    const res = await generateSvg(folder(), body.prompt, {
      filename: body.filename,
      viewBox: body.viewBox,
      color: body.color,
    });
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json({
      ...res.value,
      node: {
        $ref: "SVG",
        props: {
          content: res.value.content,
          viewBox: res.value.viewBox,
          ...(body.color ? { color: body.color } : {}),
        },
      },
    });
  });

  return r;
}
