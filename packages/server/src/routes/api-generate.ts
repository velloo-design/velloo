import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";
import { generateImage } from "../generate/generate-image.ts";
import { generateSvg } from "../generate/generate-svg.ts";

/**
 * HTTP wrappers around the AI asset generators. Mirrors the MCP tools
 * so the canvas can wire a "Generate SVG…" button without going
 * through the MCP transport.
 */
export function createGenerateRouter(folder: () => DesignFolder): Hono {
  const r = new Hono();

  r.post("/svg", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: string;
      filename?: string;
      viewBox?: string;
      color?: string;
    };
    if (!body.prompt) return c.json({ error: { kind: "EmptyPrompt" } }, 400);
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

  r.post("/image", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: string;
      filename?: string;
      aspect?: "1:1" | "4:3" | "3:4" | "16:9" | "21:9";
      width?: number;
    };
    if (!body.prompt) return c.json({ error: { kind: "EmptyPrompt" } }, 400);
    const res = await generateImage(folder(), body.prompt, {
      filename: body.filename,
      aspect: body.aspect,
      width: body.width,
    });
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json({
      ...res.value,
      node: {
        $ref: "Image",
        props: {
          src: res.value.src,
          alt: res.value.alt,
          aspect: res.value.aspect,
          fill: true,
        },
      },
    });
  });

  return r;
}
