import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CaptureNodeRect,
  captureScreenshot,
  cropPng,
  diffPngs,
  renderScreen,
  screenshotBuffer,
  screenshotCompareBuffer,
  unionRegion,
} from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { registryForScreen, resolve as resolveLocator } from "../../mutations/lookup.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import {
  PathSchema,
  RenderModeSchema,
  resolveViewport,
  ThemeNameSchema,
  ViewportSchema,
} from "./schemas.ts";
import {
  browserErrorMessage,
  captureTimeoutMessage,
  contentHeightFromRects,
  defaultViewport,
  errorResult,
  fitFramesToContent,
  framesShorterThan,
  type McpResult,
  makeLiveUrl,
  regionNode,
} from "./screenshot-helpers.ts";
import { LruMap } from "./url-capture-cache.ts";

interface Baseline {
  png: Buffer;
  rects: CaptureNodeRect[];
}

const BASELINE_CAP = 20;

export function registerScreenshotCaptureTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  assetOrigin?: string,
): void {
  const liveUrl = makeLiveUrl(ctx, bundler);

  // Diff baselines per render-parameter key, LRU-capped. Deliberately in-memory
  // only: a restart means components/themes may have changed underneath, and a
  // stale baseline produces confusing phantom diffs.
  const baselines = new LruMap<Baseline>(BASELINE_CAP);

  mcp.registerTool(
    "screenshot",
    {
      description:
        'Render a screen to PNG. mode: "light" (default) | "dark" | "compare" (side-by-side). Size via w/h (or a viewport: {w,h} object); both default to the desktop preset. fullPage defaults true. scale (0.25–1) shrinks the payload for layout checks; path ("@id" or array) captures one element; theme renders with a named theme. diff: true compares against your previous capture with the same params — zero change returns text only, small changes return a highlight crop with the changed nodes named, big changes return the new full image. resetBaseline: true re-establishes the baseline without comparing. The plain (non-diff, whole-screen) result also returns text with `contentHeight` (the screen\'s full rendered height in CSS px) and `framesShorterThanContent` — any board frame whose fixed height clips this screen below the fold, so you know which placements to resize. fitFrames: true auto-resizes those clipping frames to the content height in the same call (returns `fittedFrames`) instead of just reporting them.',
      inputSchema: {
        screenId: z.string(),
        w: z.number().int().positive().optional(),
        h: z.number().int().positive().optional(),
        viewport: ViewportSchema.optional().describe(
          "Alternative to flat w/h; explicit w/h win if both are given",
        ),
        mode: RenderModeSchema,
        fullPage: z.boolean().optional(),
        scale: z.number().min(0.25).max(1).optional(),
        path: PathSchema.optional().describe(
          'Capture only this node — path array or "@id" (not with mode: "compare"). Omit it (or pass "@root"/[]) to capture the whole screen, which is the default.',
        ),
        theme: ThemeNameSchema,
        diff: z.boolean().optional().describe("Compare against the previous same-params capture"),
        resetBaseline: z.boolean().optional(),
        fitFrames: z
          .boolean()
          .optional()
          .describe(
            "Resize any board frame that clips this screen up to its content height (returns `fittedFrames`). Default false — the capture stays read-only.",
          ),
      },
    },
    async ({
      screenId,
      w,
      h,
      viewport: vp,
      mode,
      fullPage,
      scale,
      path,
      theme,
      diff,
      resetBaseline,
      fitFrames,
    }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult(`Screen not found: ${screenId}`);
      ({ w, h } = resolveViewport(w, h, vp));

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
      const viewport: Viewport = { w: w ?? defaults.w, h: h ?? defaults.h };

      if (diff) {
        try {
          const snapshotCss = await jit.build();
          const { html } = await renderScreen(screen, themeByName(ctx.folder, theme), {
            viewport,
            snapshotCss,
            registry: registryForScreen(ctx, screen),
            snippets: ctx.folder.snippets,
            customCss: ctx.folder.customCss,
            baseHref: assetOrigin,
            liveBundleUrl: liveUrl(),
            dark: mode === "dark",
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
            theme,
            fullPage: fullPage ?? true,
            scale: scale ?? 1,
          });
          const baseline = baselines.get(key);
          baselines.set(key, { png: capture.png, rects: capture.nodeRects });

          if (!baseline || resetBaseline) {
            return {
              content: [
                { type: "text", text: JSON.stringify({ diff: { baseline: "established" } }) },
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
          const summary = {
            diff: {
              changedRatio: Number(result.changedRatio.toFixed(4)),
              changedPixels: result.changedPixels,
              heightDelta: result.heightDelta,
              regions,
              baseline: "updated",
            },
          };

          if (result.changedPixels === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ diff: { changedRatio: 0, note: "no visual change" } }),
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
        const screenRegistry = registryForScreen(ctx, screen);
        if (mode === "compare") {
          const [light, dark] = await Promise.all([
            renderScreen(screen, themeByName(ctx.folder, theme), {
              viewport,
              snapshotCss,
              registry: screenRegistry,
              snippets: ctx.folder.snippets,
              customCss: ctx.folder.customCss,
              baseHref: assetOrigin,
              liveBundleUrl: liveUrl(),
              dark: false,
            }),
            renderScreen(screen, themeByName(ctx.folder, theme), {
              viewport,
              snapshotCss,
              registry: screenRegistry,
              snippets: ctx.folder.snippets,
              customCss: ctx.folder.customCss,
              baseHref: assetOrigin,
              liveBundleUrl: liveUrl(),
              dark: true,
            }),
          ]);
          buf = await screenshotCompareBuffer({
            leftHtml: light.html,
            rightHtml: dark.html,
            viewport,
            ...(scale ? { deviceScaleFactor: scale } : {}),
          });
        } else {
          const { html } = await renderScreen(screen, themeByName(ctx.folder, theme), {
            viewport,
            snapshotCss,
            registry: screenRegistry,
            snippets: ctx.folder.snippets,
            customCss: ctx.folder.customCss,
            baseHref: assetOrigin,
            liveBundleUrl: liveUrl(),
            dark: mode === "dark",
          });
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
            const shortFrames = framesShorterThan(ctx, screenId, contentHeight);
            const fitted =
              fitFrames && shortFrames.length
                ? await fitFramesToContent(ctx, shortFrames, contentHeight)
                : [];
            contentText = JSON.stringify({
              contentHeight,
              viewport: { w: viewport.w, h: viewport.h },
              ...(fitted.length
                ? { fittedFrames: fitted }
                : shortFrames.length
                  ? { framesShorterThanContent: shortFrames }
                  : {}),
            });
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
      content.push({ type: "image", data: buf.toString("base64"), mimeType: "image/png" });
      return { content };
    },
  );
}
