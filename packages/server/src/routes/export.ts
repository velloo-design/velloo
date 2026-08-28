import type { Viewport } from "@velloo/schema";
import { type Context, Hono } from "hono";
import {
  type ExportFormat,
  type ExportMode,
  type ExportPipeline,
  exportBoardHtml,
  exportBoardPdf,
  exportBoardPng,
  exportFilename,
  exportFrameHtml,
  exportFramePdf,
  exportFramePng,
  exportScreenHtml,
  findFrame,
} from "../export/core.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import { liveExtensions } from "../live/component-bundler.ts";
import { makeCanvasBundle } from "../mcp/tools/screenshot-helpers.ts";
import type { MutationContext } from "../mutations/index.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";

/**
 * User-facing export endpoints: GET /api/export/frame/<id>.<ext>,
 * /board/<id>.<ext>, /screen/<id>.html — ext ∈ png|pdf|html; ?mode=light|
 * dark|compare (compare: frame PNG only), ?scale= (PNG raster density,
 * 0.25–3), ?theme=<name>. Streams the artifact with a download disposition;
 * inlining caveats travel in the x-velloo-export-warnings header. Behind the
 * same loopback trust boundary as every other daemon route (app-level
 * localOnlyMiddleware).
 */
export function createExportRouter(
  ctxFor: () => MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
): Hono {
  const r = new Hono();

  const pipeline = (c: Context): ExportPipeline => {
    const ctx = ctxFor();
    return {
      folder: ctx.folder,
      providers: ctx.providers,
      defaultProvider: ctx.defaultProvider,
      snapshotCss: () => jit.build(),
      // The request reached us, so its Host IS the daemon origin — exactly
      // what Playwright pages need to resolve /assets/… during capture.
      assetOrigin: () => {
        const host = c.req.header("host");
        return host ? `http://${host}/` : undefined;
      },
      liveBundleUrl: () =>
        Object.keys(liveExtensions(ctx.folder.config.extensions)).length > 0
          ? `/api/live/bundle.js?v=${bundler.version}`
          : undefined,
      canvasBundleFor: makeCanvasBundle(ctx, canvasBundler),
    };
  };

  const parseTarget = (raw: string): { id: string; ext: ExportFormat } | null => {
    const m = /^(.+)\.(png|pdf|html)$/.exec(raw);
    return m?.[1] && m[2] ? { id: m[1], ext: m[2] as ExportFormat } : null;
  };

  const parseOpts = (c: Context): { mode: ExportMode; scale: number; theme?: string } | null => {
    const mode = (c.req.query("mode") ?? "light") as ExportMode;
    if (!["light", "dark", "compare"].includes(mode)) return null;
    const scale = Math.min(3, Math.max(0.25, Number(c.req.query("scale")) || 1));
    const theme = c.req.query("theme");
    return { mode, scale, ...(theme ? { theme } : {}) };
  };

  const send = (
    c: Context,
    body: Buffer | string,
    ext: ExportFormat,
    name: string,
    warnings: string[] = [],
  ): Response => {
    const type =
      ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "text/html; charset=utf-8";
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${exportFilename(name, ext)}"`,
    };
    if (warnings.length > 0) {
      headers["x-velloo-export-warnings"] = encodeURIComponent(JSON.stringify(warnings));
    }
    return c.body(typeof body === "string" ? body : new Uint8Array(body), 200, headers);
  };

  /** Uniform failure shape: BrowserMissing → 503 with the install hint; else 500. */
  const failed = (c: Context, err: unknown): Response => {
    const message = err instanceof Error ? err.message : String(err);
    const missing = err instanceof Error && err.name === "BrowserMissingError";
    return c.json({ error: message }, missing ? 503 : 500);
  };

  r.get("/frame/:file", async (c) => {
    const target = parseTarget(c.req.param("file"));
    if (!target) return c.json({ error: "expected <frameId>.png|pdf|html" }, 400);
    const opts = parseOpts(c);
    if (!opts) return c.json({ error: "mode must be light|dark|compare" }, 400);
    const p = pipeline(c);
    const found = findFrame(p.folder, target.id);
    if (!found) return c.json({ error: `frame not found: ${target.id}` }, 404);
    if (opts.mode === "compare" && target.ext !== "png") {
      return c.json({ error: 'mode "compare" is PNG-only' }, 400);
    }
    const screen = p.folder.screens.get(found.frame.screen);
    const name = found.frame.label ?? screen?.name ?? target.id;
    try {
      if (target.ext === "png") {
        return send(c, await exportFramePng(p, found.board, found.frame, opts), "png", name);
      }
      if (target.ext === "pdf") {
        return send(c, await exportFramePdf(p, found.board, found.frame, opts), "pdf", name);
      }
      const out = await exportFrameHtml(p, found.board, found.frame, opts);
      return send(c, out.html, "html", name, out.warnings);
    } catch (err) {
      return failed(c, err);
    }
  });

  r.get("/board/:file", async (c) => {
    const target = parseTarget(c.req.param("file"));
    if (!target) return c.json({ error: "expected <boardId>.png|pdf|html" }, 400);
    const opts = parseOpts(c);
    if (!opts) return c.json({ error: "mode must be light|dark|compare" }, 400);
    if (opts.mode === "compare") {
      return c.json(
        { error: 'mode "compare" is frame-only — export the board light or dark' },
        400,
      );
    }
    const p = pipeline(c);
    const board = p.folder.boards.get(target.id);
    if (!board) return c.json({ error: `board not found: ${target.id}` }, 404);
    try {
      if (target.ext === "png")
        return send(c, await exportBoardPng(p, board, opts), "png", board.name);
      if (target.ext === "pdf")
        return send(c, await exportBoardPdf(p, board, opts), "pdf", board.name);
      const out = await exportBoardHtml(p, board, opts);
      return send(c, out.html, "html", board.name, out.warnings);
    } catch (err) {
      return failed(c, err);
    }
  });

  r.get("/screen/:file", async (c) => {
    const target = parseTarget(c.req.param("file"));
    if (!target) return c.json({ error: "expected <screenId>.html" }, 400);
    if (target.ext !== "html") {
      return c.json({ error: "screen exports are HTML — export a frame for PNG/PDF" }, 400);
    }
    const opts = parseOpts(c);
    if (!opts) return c.json({ error: "mode must be light|dark" }, 400);
    const p = pipeline(c);
    const screen = p.folder.screens.get(target.id);
    if (!screen) return c.json({ error: `screen not found: ${target.id}` }, 404);
    const preset = p.folder.config.viewportPresets[0] ?? { name: "default", w: 1440, h: 900 };
    const viewport: Viewport = {
      w: Number(c.req.query("w")) || preset.w,
      h: Number(c.req.query("h")) || preset.h,
    };
    try {
      const out = await exportScreenHtml(p, screen, {
        dark: opts.mode === "dark",
        ...(opts.theme ? { theme: opts.theme } : {}),
        viewport,
      });
      return send(c, out.html, "html", screen.name || screen.id, out.warnings);
    } catch (err) {
      return failed(c, err);
    }
  });

  return r;
}
