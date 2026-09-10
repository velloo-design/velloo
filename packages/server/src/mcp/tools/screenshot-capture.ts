import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CaptureNodeRect,
  captureScreenshot,
  cropPng,
  diffPngs,
  screenshotBuffer,
  screenshotCompareBuffer,
  unionRegion,
} from "@velloo/renderer";
import type { FrameScheme, Viewport } from "@velloo/schema";
import { z } from "zod";
import {
  type DesignFolder,
  pinnedSchemeForScreen,
  pinnedThemeForScreen,
  resolveNamedTheme,
} from "../../design-folder.ts";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { resolve as resolveLocator } from "../../mutations/lookup.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { diagnosticsForScreen } from "../diagnostics.ts";
import { errorResult, type McpResult } from "./result.ts";
import { PathSchema, RenderModeSchema, ThemeNameSchema, ViewportArgSchema } from "./schemas.ts";
import {
  browserErrorMessage,
  captureTimeoutMessage,
  contentHeightFromRects,
  defaultViewport,
  framesShorterThan,
  makeCanvasBundle,
  makeLiveUrl,
  mountDiagnostics,
  regionNode,
  renderForCapture,
} from "./screenshot-helpers.ts";
import { LruMap } from "./url-capture-cache.ts";

interface Baseline {
  png: Buffer;
  rects: CaptureNodeRect[];
}

const BASELINE_CAP = 20;
/** Cap the baseline cache's total PNG bytes (~64MB) so many large shots can't grow unbounded. */
const BASELINE_MAX_BYTES = 64 * 1024 * 1024;

type ScreenshotMode = FrameScheme | "compare";

export function resolveScreenshotMode(
  folder: Pick<DesignFolder, "boards">,
  screenId: string,
  explicit: ScreenshotMode | undefined,
): { ok: true; mode: ScreenshotMode } | { ok: false; message: string } {
  if (explicit !== undefined) return { ok: true, mode: explicit };
  const pinned = pinnedSchemeForScreen(folder, screenId);
  if (!pinned.ok) return pinned;
  return { ok: true, mode: pinned.scheme ?? "light" };
}

export function registerScreenshotCaptureTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  assetOrigin?: string,
): void {
  const liveUrl = makeLiveUrl(ctx, bundler);
  const canvasBundle = makeCanvasBundle(ctx, canvasBundler);

  // Diff baselines per render-parameter key, LRU-capped. Deliberately in-memory
  // only: a restart means components/themes may have changed underneath, and a
  // stale baseline produces confusing phantom diffs.
  const baselines = new LruMap<Baseline>(BASELINE_CAP, {
    maxBytes: BASELINE_MAX_BYTES,
    sizeOf: (b) => b.png.byteLength,
  });

  mcp.registerTool(
    "screenshot",
    {
      description:
        "Render a screen to PNG and run full class/theme diagnostics. `mode: \"compare\"` returns light and dark side by side — the fastest check that a design adapts; omitted, mode follows the hosting frame's pin. `diff: true` compares against your previous capture. `scale` (0.25–1) shrinks the payload; `path` captures one element. The render uses its OWN viewport, not the board frame's, so `framesShorterThanContent` names placements that clip below the fold — resize them with `update_frame`. Guide: velloo://guide/verification.",
      inputSchema: {
        screenId: z.string(),
        viewport: ViewportArgSchema.optional().describe(
          "Render size; defaults to the folder's Desktop preset",
        ),
        mode: RenderModeSchema,
        fullPage: z.boolean().optional(),
        scale: z.number().min(0.25).max(1).optional(),
        path: PathSchema.optional().describe(
          'Capture only this node — path array or "@id" (not with mode: "compare"). Omit it (or pass "@root"/[]) to capture the whole screen, which is the default.',
        ),
        theme: ThemeNameSchema.describe(
          "Named theme to render with; default = the hosting board's pin, else the folder default",
        ),
        diff: z.boolean().optional().describe("Compare against the previous same-params capture"),
        resetBaseline: z.boolean().optional(),
      },
    },
    async ({ screenId, viewport: vp, mode, fullPage, scale, path, theme, diff, resetBaseline }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult(`Screen not found: ${screenId}`);
      const diagnostics = [
        ...(await diagnosticsForScreen(ctx, jit, screen).catch(() => [])),
        ...(await mountDiagnostics(ctx, canvasBundler, screen)),
      ];
      const withDiagnostics = <T extends object>(value: T): T & { diagnostics?: unknown } => ({
        ...value,
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });

      const resolvedMode = resolveScreenshotMode(ctx.folder, screenId, mode);
      if (!resolvedMode.ok) return errorResult(resolvedMode.message);
      mode = resolvedMode.mode;

      // Match what the canvas shows: no explicit theme → the hosting board's pin.
      let themeName = theme;
      if (themeName === undefined) {
        const pinned = pinnedThemeForScreen(ctx.folder, screenId);
        if (!pinned.ok) return errorResult(pinned.message);
        themeName = pinned.name;
      }

      if (diff && (mode === "compare" || path !== undefined)) {
        return errorResult('screenshot: diff cannot combine with mode: "compare" or path');
      }

      let clipSelector: string | undefined;
      if (path !== undefined) {
        if (mode === "compare") {
          return errorResult('screenshot: path cannot be combined with mode: "compare"');
        }
        // "@root", [] and "[]" all mean the whole tree — capture the full screen (no clip).
        const isWholeTree =
          path === "@root" ||
          (Array.isArray(path) && path.length === 0) ||
          (typeof path === "string" && path.replace(/\s/g, "") === "[]");
        if (!isWholeTree) {
          const resolved = resolveLocator(screen.tree, path, screenId);
          if (!resolved.ok) return errorResult(JSON.stringify(resolved.error));
          clipSelector = `[data-node-path="${resolved.value.join(".")}"]`;
        }
      }

      const defaults = defaultViewport(ctx.folder);
      const viewport: Viewport = { w: vp?.w ?? defaults.w, h: vp?.h ?? defaults.h };

      if (diff) {
        try {
          const snapshotCss = await jit.build();
          const _themeRes = resolveNamedTheme(ctx.folder, themeName);
          if (!_themeRes.ok) return errorResult(_themeRes.message);
          const html = await renderForCapture(ctx, screen, {
            theme: _themeRes.theme,
            dark: mode === "dark",
            viewport,
            snapshotCss,
            liveUrl,
            canvasBundle,
            assetOrigin,
          });
          const capture = await captureScreenshot({
            html,
            viewport,
            fullPage: fullPage ?? true,
            ...(scale ? { deviceScaleFactor: scale } : {}),
          });
          const key = JSON.stringify({
            screenId,
            w: viewport.w,
            h: viewport.h,
            mode,
            theme: themeName,
            fullPage: fullPage ?? true,
            scale: scale ?? 1,
          });
          const baseline = baselines.get(key);
          baselines.set(key, { png: capture.png, rects: capture.nodeRects });

          if (!baseline || resetBaseline) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(withDiagnostics({ diff: { baseline: "established" } })),
                },
                { type: "image", data: capture.png.toString("base64"), mimeType: "image/png" },
              ],
            };
          }

          const result = diffPngs(baseline.png, capture.png);
          const scaleFactor = scale ?? 1;
          const regions = result.regions.map((r) => ({
            ...r,
            node: regionNode(r, capture.nodeRects, scaleFactor, screen),
          }));
          const summary = withDiagnostics({
            diff: {
              changedRatio: Number(result.changedRatio.toFixed(4)),
              changedPixels: result.changedPixels,
              heightDelta: result.heightDelta,
              regions,
              baseline: "updated",
            },
          });

          if (result.changedPixels === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    withDiagnostics({ diff: { changedRatio: 0, note: "no visual change" } }),
                  ),
                },
              ],
            };
          }
          if (result.changedRatio < 0.4 && regions.length > 0) {
            const crop = cropPng(result.diffPng, unionRegion(result.regions));
            return {
              content: [
                { type: "text", text: JSON.stringify(summary) },
                { type: "image", data: crop.toString("base64"), mimeType: "image/png" },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ...summary,
                  note: "changes too widespread for an overlay — new capture follows",
                }),
              },
              { type: "image", data: capture.png.toString("base64"), mimeType: "image/png" },
            ],
          };
        } catch (err) {
          const bm = browserErrorMessage(err);
          if (bm) return errorResult(bm);
          const tm = captureTimeoutMessage(err, "screenshot diff");
          if (tm) return errorResult(tm);
          const msg = err instanceof Error ? err.message : String(err);
          return errorResult(`screenshot diff failed: ${msg}`);
        }
      }

      let buf: Buffer;
      let contentText: string | null = null;
      try {
        const snapshotCss = await jit.build();
        const _themeRes = resolveNamedTheme(ctx.folder, themeName);
        if (!_themeRes.ok) return errorResult(_themeRes.message);
        const base = {
          theme: _themeRes.theme,
          viewport,
          snapshotCss,
          liveUrl,
          canvasBundle,
          assetOrigin,
        };
        if (mode === "compare") {
          const [lightHtml, darkHtml] = await Promise.all([
            renderForCapture(ctx, screen, { ...base, dark: false }),
            renderForCapture(ctx, screen, { ...base, dark: true }),
          ]);
          buf = await screenshotCompareBuffer({
            leftHtml: lightHtml,
            rightHtml: darkHtml,
            viewport,
            ...(scale ? { deviceScaleFactor: scale } : {}),
          });
        } else {
          const html = await renderForCapture(ctx, screen, { ...base, dark: mode === "dark" });
          if (clipSelector) {
            buf = await screenshotBuffer({
              html,
              viewport,
              fullPage: fullPage ?? true,
              ...(scale ? { deviceScaleFactor: scale } : {}),
              clipSelector,
            });
          } else {
            // captureScreenshot also measures node rects, so we can report the
            // screen's true content height + any frame it overflows — the only
            // signal that a fixed-size board frame is clipping below the fold.
            const capture = await captureScreenshot({
              html,
              viewport,
              fullPage: fullPage ?? true,
              ...(scale ? { deviceScaleFactor: scale } : {}),
            });
            buf = capture.png;
            const contentHeight = contentHeightFromRects(capture.nodeRects);
            const shortFrames = framesShorterThan(ctx, screenId, contentHeight, viewport.w);
            contentText = JSON.stringify(
              withDiagnostics({
                contentHeight,
                theme: themeName ?? "default",
                viewport: { w: viewport.w, h: viewport.h },
                ...(shortFrames.length ? { framesShorterThanContent: shortFrames } : {}),
              }),
            );
          }
        }
      } catch (err) {
        const bm = browserErrorMessage(err);
        if (bm) return errorResult(bm);
        const tm = captureTimeoutMessage(err, "screenshot");
        if (tm) return errorResult(tm);
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`screenshot failed: ${msg}`);
      }
      const content: McpResult["content"] = [];
      if (contentText) content.push({ type: "text", text: contentText });
      else if (diagnostics.length > 0) {
        content.push({ type: "text", text: JSON.stringify({ diagnostics }) });
      }
      content.push({ type: "image", data: buf.toString("base64"), mimeType: "image/png" });
      return { content };
    },
  );
}
