import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  captureDir,
  cropPng,
  type DomExtract,
  type DomNode,
  downscalePng,
  HeadedBrowserMissingError,
  isSafeCaptureId,
  listCaptures,
  readCaptureManifest,
  type ThemeVars,
} from "@velloo/renderer";
import { z } from "zod";
import { emitActivity } from "../../activity.ts";
import { openSession, sessionStatuses } from "../../capture/sessions.ts";
import { pngSize } from "../../fs.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, type McpResult } from "./result.ts";

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Enough of a file to read a header from; empty when it isn't readable. */
function readBytes(path: string, length = 32): Buffer {
  try {
    return readFileSync(path).subarray(0, length);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Nodes the page lays out but a reader cannot see.
 *
 * The DOM walker already drops `display: none` and `visibility: hidden`, so
 * what survives to here is the harder case: `opacity: 0` (a hover-only panel,
 * a fade-in still waiting on script) and rects that sit outside the captured
 * page box. Opacity is NOT an inherited property — a child of a transparent
 * container computes its own `opacity: 1` — so the state has to be propagated
 * down, which is a single forward pass because the flat list is pre-order and
 * a parent therefore always precedes its children.
 *
 * Without this the *contents* of a hidden container read as ordinary page
 * copy, which is how a hover-only panel gets ported as a permanent card.
 */
function invisibleNodes(
  dom: DomExtract,
  verticalScope?: { from: number; to: number },
): { hidden: Set<number>; offscreen: Set<number> } {
  const hidden = new Set<number>();
  const offscreen = new Set<number>();
  for (const n of dom.nodes) {
    if (n.parent !== null && hidden.has(n.parent)) hidden.add(n.i);
    else if (n.style.opacity !== undefined && Number(n.style.opacity) === 0) hidden.add(n.i);
    // A full-page screenshot is viewport-wide, so anything wholly left of, above,
    // or right of that box is absent from the reference image whatever the DOM
    // says. `left: -9999px` and a carousel's off-stage slides both land here.
    const { x, y, w, h } = n.rect;
    if (
      x + w <= 0 ||
      y + h <= (verticalScope?.from ?? 0) ||
      x >= dom.viewport.w ||
      (verticalScope !== undefined && y >= verticalScope.to)
    ) {
      offscreen.add(n.i);
    }
  }
  return { hidden, offscreen };
}

interface Outline {
  lines: string[];
  shown: number;
  hiddenCount: number;
  coverage: { fromY: number; toY: number; documentHeight: number };
}

function meaningfulNodes(dom: DomExtract): DomNode[] {
  return dom.nodes.filter(
    (n) =>
      n.repeat !== undefined ||
      (n.text !== undefined && n.text.length > 1) ||
      ["header", "nav", "main", "section", "footer", "aside", "form", "table"].includes(n.tag),
  );
}

/** Pick across the document instead of spending the whole digest above the fold. */
function spatialSample(nodes: DomNode[], dom: DomExtract, limit: number): DomNode[] {
  if (nodes.length <= limit) return nodes;
  const selected = new Set<number>();
  const viewportHeight = Math.max(1, dom.viewport.h);
  const bandCount = Math.max(1, Math.ceil(dom.documentHeight / viewportHeight));
  const bandBudget = Math.min(bandCount, Math.max(1, Math.floor(limit / 2)));
  for (let slot = 0; slot < bandBudget; slot++) {
    const band = Math.min(bandCount - 1, Math.floor((slot * bandCount) / bandBudget));
    const inBand = nodes.filter((n) => Math.floor(Math.max(0, n.rect.y) / viewportHeight) === band);
    const pick =
      inBand.find((n) => n.repeat !== undefined) ??
      inBand.find((n) => ["header", "nav", "main", "section", "footer", "aside"].includes(n.tag)) ??
      inBand[0];
    if (pick) selected.add(pick.i);
  }
  const remaining = limit - selected.size;
  for (let slot = 0; slot < remaining; slot++) {
    const index = Math.min(nodes.length - 1, Math.floor((slot * nodes.length) / remaining));
    const pick = nodes[index];
    if (pick) selected.add(pick.i);
  }
  if (selected.size < limit) {
    for (const node of nodes) {
      selected.add(node.i);
      if (selected.size >= limit) break;
    }
  }
  return nodes.filter((n) => selected.has(n.i)).slice(0, limit);
}

/**
 * A readable digest of a DOM extract: the structural spine plus the repeated
 * blocks. The full `dom.json` can run to a thousand nodes, which is evidence
 * to read on demand — not something to push into an agent's context wholesale
 * on every `get_capture`.
 *
 * Position and visibility ride along because without them the digest is not
 * merely thinner than the truth, it contradicts it: a size alone reads as flow
 * content, so a pill at (819, 909) above a carousel looks like a caption, and
 * a transparent panel looks like a card.
 */
export function outlineOf(
  dom: DomExtract,
  limit = 60,
  verticalScope?: { from: number; to: number },
): Outline {
  const { hidden, offscreen } = invisibleNodes(dom, verticalScope);
  const lines: string[] = [];
  const sampled = spatialSample(meaningfulNodes(dom), dom, limit);
  for (const n of sampled) {
    const indent = "  ".repeat(Math.min(n.depth, 8));
    const rep = n.repeat ? ` ×${n.repeat.count}` : "";
    const text = n.text ? ` "${n.text.slice(0, 60)}"` : "";
    const flags: string[] = [];
    // Name the cause on the node that owns it; a descendant carries the bare
    // marker, so the toggle to look for is the one line without a reason.
    if (hidden.has(n.i)) {
      flags.push(Number(n.style.opacity) === 0 ? "HIDDEN(opacity:0)" : "HIDDEN");
    }
    if (offscreen.has(n.i)) flags.push("OFFSCREEN");
    const marks = flags.length ? ` ${flags.join(" ")}` : "";
    const { x, y, w, h } = n.rect;
    lines.push(`${indent}${n.tag}${rep}${text} [${w}×${h} @${x},${y}]${marks}`);
  }
  const ys = sampled.flatMap((n) => [n.rect.y, n.rect.y + n.rect.h]);
  return {
    lines,
    shown: lines.length,
    hiddenCount: hidden.size + offscreen.size,
    coverage: {
      fromY: ys.length ? Math.min(...ys) : 0,
      toY: ys.length ? Math.max(...ys) : 0,
      documentHeight: dom.documentHeight,
    },
  };
}

function queriedNodes(
  dom: DomExtract,
  input: {
    yFrom?: number;
    yTo?: number;
    tags?: string[];
    visibleOnly?: boolean;
    offset?: number;
    limit?: number;
    verticalScope?: { from: number; to: number };
  },
): { nodes: DomNode[]; total: number; offset: number; nextOffset: number | null } {
  const { hidden, offscreen } = invisibleNodes(dom, input.verticalScope);
  const tags = input.tags ? new Set(input.tags.map((tag) => tag.toLowerCase())) : null;
  const matches = dom.nodes.filter((node) => {
    if (tags && !tags.has(node.tag)) return false;
    if (input.visibleOnly && (hidden.has(node.i) || offscreen.has(node.i))) return false;
    if (input.yFrom !== undefined && node.rect.y + node.rect.h <= input.yFrom) return false;
    if (input.yTo !== undefined && node.rect.y >= input.yTo) return false;
    return true;
  });
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 200;
  const nodes = matches.slice(offset, offset + limit);
  const next = offset + nodes.length;
  return { nodes, total: matches.length, offset, nextOffset: next < matches.length ? next : null };
}

function previewOf(
  png: Buffer,
  manifest: ReturnType<typeof readCaptureManifest> & {},
  input: {
    mode: "overview" | "viewport" | "crop";
    xFrom?: number;
    xTo?: number;
    yFrom?: number;
    yTo?: number;
    maxWidth?: number;
  },
): { png: Buffer; meta: Record<string, unknown> } | { error: string } {
  const bitmap = pngSize(png);
  if (!bitmap) return { error: "capture preview is not a readable PNG" };
  const viewportWidth = manifest.geometry?.viewportCss.width ?? manifest.viewport.w;
  const viewportHeight = manifest.geometry?.viewportCss.height ?? manifest.viewport.h;
  const bitmapScale = viewportWidth > 0 ? bitmap.width / viewportWidth : 1;
  let out = png;
  let cssRegion: { x: number; y: number; w: number; h: number } | null = null;
  if (input.mode !== "overview") {
    const scroll = manifest.geometry?.scrollCss ?? { x: 0, y: 0 };
    const sourceIsViewport = manifest.geometry?.screenshot?.mode === "viewport";
    const x = input.mode === "viewport" ? scroll.x : (input.xFrom ?? 0);
    const y = input.mode === "viewport" ? scroll.y : (input.yFrom ?? 0);
    const xTo = input.mode === "viewport" ? x + viewportWidth : (input.xTo ?? viewportWidth);
    const yTo = input.mode === "viewport" ? y + viewportHeight : (input.yTo ?? y + viewportHeight);
    if (xTo <= x || yTo <= y)
      return { error: "capture preview crop must have positive width and height" };
    cssRegion = { x, y, w: xTo - x, h: yTo - y };
    if (!(input.mode === "viewport" && sourceIsViewport)) {
      const origin = sourceIsViewport ? scroll : { x: 0, y: 0 };
      const pixelRegion = {
        x: Math.round((x - origin.x) * bitmapScale),
        y: Math.round((y - origin.y) * bitmapScale),
        w: Math.round((xTo - x) * bitmapScale),
        h: Math.round((yTo - y) * bitmapScale),
      };
      if (
        pixelRegion.x >= bitmap.width ||
        pixelRegion.y >= bitmap.height ||
        pixelRegion.x + pixelRegion.w <= 0 ||
        pixelRegion.y + pixelRegion.h <= 0
      ) {
        return { error: "capture preview crop does not intersect page.png" };
      }
      const left = Math.max(0, pixelRegion.x);
      const top = Math.max(0, pixelRegion.y);
      const right = Math.min(bitmap.width, pixelRegion.x + pixelRegion.w);
      const bottom = Math.min(bitmap.height, pixelRegion.y + pixelRegion.h);
      out = cropPng(png, { x: left, y: top, w: right - left, h: bottom - top }, 0);
      cssRegion = {
        x: origin.x + left / bitmapScale,
        y: origin.y + top / bitmapScale,
        w: (right - left) / bitmapScale,
        h: (bottom - top) / bitmapScale,
      };
    }
  }
  const size = pngSize(out);
  if (!size) return { error: "capture preview crop is not a readable PNG" };
  const maxWidth = input.maxWidth ?? 1_400;
  const maxPixels = 4_000_000;
  let factor = Math.max(
    1,
    Math.ceil(size.width / maxWidth),
    Math.ceil(Math.sqrt((size.width * size.height) / maxPixels)),
  );
  if (factor > 1) out = downscalePng(out, factor);
  // MCP image data is base64-expanded in transit. Keep the binary below
  // 3.5 MB so even a noisy PNG stays under a roughly 5 MB payload ceiling.
  while (out.byteLength > 3_500_000) {
    const current = pngSize(out);
    if (!current || (current.width === 1 && current.height === 1)) break;
    out = downscalePng(out, 2);
    factor *= 2;
  }
  const finalSize = pngSize(out);
  return {
    png: out,
    meta: {
      mode: input.mode,
      bitmap: finalSize,
      sourceBitmap: bitmap,
      bitmapScale,
      downscaleFactor: factor,
      ...(cssRegion ? { cssRegion } : {}),
    },
  };
}

function captureCapabilities(
  manifest: NonNullable<ReturnType<typeof readCaptureManifest>>,
): string[] {
  if (manifest.themeOnly) return ["theme-import"];
  if (manifest.stability?.status === "unstable") return ["preview"];
  return ["theme-import", "outline", "comparison", "preview"];
}

export function registerCaptureTools(mcp: McpServer, ctx: MutationContext): void {
  const folderId = (): string | undefined => ctx.folder.config.folderId;

  mcp.registerTool(
    "start_capture_session",
    {
      description:
        "Open a real browser window the USER drives, to reach a page behind a login or on staging. Returns a sessionId IMMEDIATELY — never treat it as blocking and never re-call it to check; poll list_captures instead, and tell the user to log in, hit **Capture page** per page, then **Done**. Guide: velloo://guide/capture.",
      inputSchema: {
        url: z
          .string()
          .optional()
          .describe("Page to open the browser on. The session is scoped to this origin."),
      },
    },
    async ({ url }) => {
      if (url !== undefined) {
        let scheme: string;
        try {
          scheme = new URL(url).protocol;
        } catch {
          return errorResult(`Invalid url: ${url}`);
        }
        if (scheme !== "http:" && scheme !== "https:") {
          return errorResult(
            `start_capture_session: only http(s) URLs are allowed (got ${scheme})`,
          );
        }
      }
      try {
        const session = await openSession(ctx, {
          ...(url ? { url } : {}),
          onStatus: (message) => {
            console.error(`velloo capture: ${message}`);
          },
        });
        // Opening a browser the user is about to type real credentials into is
        // not a silent side effect: it lands in the canvas activity feed and on
        // the daemon's console, so a session an agent started is visible as one.
        emitActivity(ctx, "start_capture_session", {});
        console.error(
          `velloo capture: an agent opened a capture session${url ? ` on ${url}` : ""} — the browser window is yours to drive.`,
        );
        return jsonResult({
          sessionId: session.handle.sessionId,
          url: url ?? null,
          status: "open",
          note: "The browser window is open and the user is driving it. This call did NOT wait — poll list_captures, whose `sessions[]` reports whether the window is still open and what page the user is on, and tell them to hit 'Capture page' in the toolbar on each page you need, then 'Done'.",
        });
      } catch (err) {
        if (err instanceof HeadedBrowserMissingError) return errorResult(err.message);
        return errorResult(
          `start_capture_session failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  mcp.registerTool(
    "list_captures",
    {
      description:
        "Stored browser captures for this folder, newest first, plus open session state. `kind`, `purpose`, and `usableFor` distinguish automatic theme snapshots from user-requested frozen pages; geometry names CSS, bitmap, viewport, DPR, and replay sizes separately. Read a capture with `get_capture`; compare a page capture via `compare_to_url { source: { captureId } }`. Poll `sessions[]` rather than re-calling `start_capture_session`.",
      inputSchema: {},
    },
    async () => {
      const captures = listCaptures(ctx.folder.root, folderId()).map((m) => ({
        captureId: m.id,
        url: m.finalUrl || m.url,
        title: m.title,
        capturedAt: m.capturedAt,
        viewport: m.viewport,
        themeOnly: m.themeOnly,
        kind: m.kind ?? (m.themeOnly ? "theme" : "page"),
        purpose: m.themeOnly
          ? "Automatic theme snapshot; use for import_theme, not visual comparison."
          : "User-requested frozen page; use for outline, preview, and comparison.",
        usableFor: captureCapabilities(m),
        ...(m.sessionId ? { sessionId: m.sessionId } : {}),
        ...(m.stability ? { stability: m.stability.status } : {}),
        ...(m.geometry ? { geometry: m.geometry } : {}),
        nodeCount: m.nodeCount,
        assetCount: m.assetCount,
      }));
      const sessions = sessionStatuses();
      const open = sessions.find((s) => s.status === "open");
      return jsonResult({
        captures,
        sessions,
        ...(open
          ? {
              note: `A capture session is open${open.currentUrl ? ` on ${open.currentUrl}` : ""}. The user drives it: ask them to reach each page you need and hit 'Capture page', then 'Done'. Poll this tool — do not call start_capture_session again.`,
            }
          : captures.length === 0
            ? {
                note: sessions.length
                  ? "The capture session has closed and produced nothing. Ask the user whether they hit 'Capture page' before 'Done', then start another session."
                  : "No captures yet. `start_capture_session` opens a browser for the user to log in and capture pages from.",
              }
            : {}),
      });
    },
  );

  mcp.registerTool(
    "get_capture",
    {
      description:
        "Read one stored capture: a spatial page outline with rects, visibility markers, repeated blocks, theme CSS, assets, and explicit CSS/bitmap/replay geometry. Use `image` for a bounded inline overview, viewport, or crop of authoritative `page.png`; use `full: true` or y/tag filters with offset + limit for paginated computed-style nodes. Feed the theme CSS to `import_theme` BEFORE composing. Guide: velloo://guide/capture.",
      inputSchema: {
        captureId: z.string(),
        full: z
          .boolean()
          .optional()
          .describe("Return the first paginated node page with computed styles. Default false."),
        yFrom: z
          .number()
          .nonnegative()
          .optional()
          .describe("Only nodes crossing this CSS-pixel Y."),
        yTo: z.number().positive().optional().describe("Only nodes before this CSS-pixel Y."),
        tags: z.array(z.string().min(1)).optional(),
        visibleOnly: z.boolean().optional(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Default 200, max 500."),
        image: z
          .strictObject({
            mode: z.enum(["overview", "viewport", "crop"]),
            xFrom: z.number().nonnegative().optional(),
            xTo: z.number().positive().optional(),
            yFrom: z.number().nonnegative().optional(),
            yTo: z.number().positive().optional(),
            maxWidth: z.number().int().min(100).max(2_000).optional(),
          })
          .optional()
          .describe(
            "Return a bounded inline PNG overview, captured viewport, or CSS-coordinate crop.",
          ),
      },
    },
    async ({ captureId, full, yFrom, yTo, tags, visibleOnly, offset, limit, image }) => {
      if (!isSafeCaptureId(captureId)) return errorResult(`Invalid captureId: ${captureId}`);
      const manifest = readCaptureManifest(ctx.folder.root, captureId, folderId());
      if (!manifest) {
        return errorResult(`No capture "${captureId}" for this folder — call list_captures.`);
      }
      const dir = captureDir(ctx.folder.root, captureId, folderId());
      const readJson = <T>(file: string): T | null => {
        try {
          return JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
        } catch {
          return null;
        }
      };
      const theme = readJson<ThemeVars>("computed-vars.json");
      const dom = manifest.themeOnly ? null : readJson<DomExtract>("dom.json");
      const assets = readJson<{ assets: Array<{ url: string; file: string }> }>("assets.json");
      const verticalScope =
        manifest.geometry?.screenshot?.mode === "viewport"
          ? {
              from: manifest.geometry.scrollCss.y,
              to: manifest.geometry.scrollCss.y + manifest.geometry.viewportCss.height,
            }
          : undefined;
      const outline = dom ? outlineOf(dom, 60, verticalScope) : null;
      // A bare filename is unopenable: the store lives under ~/.velloo, not in
      // the design folder, so an agent that goes looking for `page.png` from
      // the project searches the wrong tree. Hand back the paths.
      const files = manifest.files.map((name) => {
        const path = join(dir, name);
        const size = name.endsWith(".png") ? pngSize(readBytes(path)) : null;
        return { name, path, ...(size ?? {}) };
      });
      const screenshot = files.find((f) => f.name === "page.png");
      const wantsNodes = Boolean(
        full || yFrom !== undefined || yTo !== undefined || tags || visibleOnly || offset || limit,
      );
      const nodePage =
        dom && wantsNodes
          ? queriedNodes(dom, {
              ...(yFrom !== undefined ? { yFrom } : {}),
              ...(yTo !== undefined ? { yTo } : {}),
              ...(tags !== undefined ? { tags } : {}),
              ...(visibleOnly !== undefined ? { visibleOnly } : {}),
              ...(offset !== undefined ? { offset } : {}),
              ...(limit !== undefined ? { limit } : {}),
              ...(verticalScope !== undefined ? { verticalScope } : {}),
            })
          : null;

      const body = {
        captureId,
        url: manifest.finalUrl || manifest.url,
        title: manifest.title,
        capturedAt: manifest.capturedAt,
        viewport: manifest.viewport,
        themeOnly: manifest.themeOnly,
        kind: manifest.kind ?? (manifest.themeOnly ? "theme" : "page"),
        usableFor: captureCapabilities(manifest),
        ...(manifest.stateId ? { stateId: manifest.stateId } : {}),
        ...(manifest.geometry ? { geometry: manifest.geometry } : {}),
        ...(manifest.stability ? { stability: manifest.stability } : {}),
        ...(manifest.stability?.status === "unstable"
          ? {
              warning:
                "The page changed while screenshot and DOM evidence were recorded. Preview is available, but re-capture after the page settles before using its outline or comparison.",
            }
          : {}),
        ...(theme
          ? {
              themeCss: theme.css,
              fonts: theme.fonts,
              tokenCount: Object.keys(theme.light).length + Object.keys(theme.dark).length,
            }
          : {}),
        ...(dom && outline
          ? nodePage
            ? {
                documentHeight: dom.documentHeight,
                nodes: nodePage.nodes,
                nodeQuery: {
                  total: nodePage.total,
                  returned: nodePage.nodes.length,
                  offset: nodePage.offset,
                  nextOffset: nodePage.nextOffset,
                },
                truncated: dom.truncated,
              }
            : {
                documentHeight: dom.documentHeight,
                outline: outline.lines,
                outlineShown: outline.shown,
                outlineCoverage: outline.coverage,
                nodeCount: dom.nodes.length,
                truncated: dom.truncated,
                note:
                  `Digest of ${outline.shown} of ${dom.nodes.length} nodes — rects are ` +
                  `\`[w×h @x,y]\` in page coordinates. ` +
                  (outline.hiddenCount > 0
                    ? `${outline.hiddenCount} node(s) are marked HIDDEN or OFFSCREEN: they lay out but do not appear in page.png, so a hover-only or off-stage block is NOT ordinary page content — model it as such or leave it out. `
                    : "") +
                  (screenshot
                    ? `page.png (${screenshot.width}×${screenshot.height}) is the authoritative reference — open it. `
                    : "") +
                  `Use full: true or yFrom/yTo/tags with offset + limit for paginated computed styles.`,
              }
          : {}),
        ...(assets ? { assets: assets.assets } : {}),
        dir,
        files,
        ...(screenshot
          ? {
              verifyWith: `compare_to_url { screenId: "<your screen>", source: { captureId: "${captureId}" } }`,
            }
          : {}),
      };
      if (!image) return jsonResult(body);
      if (!screenshot) return errorResult(`Capture "${captureId}" has no page.png to preview.`);
      const preview = previewOf(readFileSync(screenshot.path), manifest, {
        mode: image.mode,
        ...(image.xFrom !== undefined ? { xFrom: image.xFrom } : {}),
        ...(image.xTo !== undefined ? { xTo: image.xTo } : {}),
        ...(image.yFrom !== undefined ? { yFrom: image.yFrom } : {}),
        ...(image.yTo !== undefined ? { yTo: image.yTo } : {}),
        ...(image.maxWidth !== undefined ? { maxWidth: image.maxWidth } : {}),
      });
      if ("error" in preview) return errorResult(preview.error);
      return {
        content: [
          { type: "text", text: JSON.stringify({ ...body, preview: preview.meta }) },
          { type: "image", data: preview.png.toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );
}
