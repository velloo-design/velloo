import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CaptureNodeRect,
  captureScreenshot,
  captureUrlScreenshot,
  cropPng,
  type DiffRegion,
  diffPngs,
  renderScreen,
  screenshotBuffer,
  screenshotCompareBuffer,
  sideBySidePng,
  unionRegion,
} from "@velloo/renderer";
import { isComponentNode, nodeId, type Screen, type Viewport } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { registryForScreen, resolve as resolveLocator } from "../../mutations/lookup.ts";
import { pathAt } from "../../path.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";

type McpResult = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: true;
};

function errorResult(text: string): McpResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function playwrightMissingMessage(msg: string): string {
  return `screenshot: Playwright is not installed. Run \`bunx playwright install chromium\`. Underlying error: ${msg}`;
}

function defaultViewport(folder: {
  config: { viewportPresets: Array<{ name: string; w: number; h: number }> };
}): Viewport {
  // Prefer Desktop, fall back to first preset.
  const presets = folder.config.viewportPresets;
  const desktop = presets.find((p) => p.name.toLowerCase().includes("desktop"));
  const pick = desktop ?? presets[0] ?? { w: 1440, h: 900 };
  return { w: pick.w, h: pick.h };
}

interface Baseline {
  png: Buffer;
  rects: CaptureNodeRect[];
}

const BASELINE_CAP = 20;

/** Region → deepest node mapping. Rects are CSS px; regions are image px. */
function regionNode(
  region: DiffRegion,
  rects: CaptureNodeRect[],
  scaleFactor: number,
  screen: Screen,
): { path: number[]; ref?: string; id?: string } | null {
  const area = region.w * region.h;
  const candidates = rects
    .map((r) => ({
      path: r.path,
      x: r.x * scaleFactor,
      y: r.y * scaleFactor,
      w: r.w * scaleFactor,
      h: r.h * scaleFactor,
    }))
    .filter((r) => {
      const ix = Math.max(0, Math.min(r.x + r.w, region.x + region.w) - Math.max(r.x, region.x));
      const iy = Math.max(0, Math.min(r.y + r.h, region.y + region.h) - Math.max(r.y, region.y));
      return ix * iy >= area * 0.5;
    })
    .sort((a, b) => a.w * a.h - b.w * b.h);
  const best = candidates[0];
  if (!best) return null;
  const path = best.path === "" ? [] : best.path.split(".").map(Number);
  const node = pathAt(screen.tree, path);
  if (!node) return { path };
  return {
    path,
    ...(isComponentNode(node) ? { ref: node.$ref } : {}),
    ...(nodeId(node) ? { id: nodeId(node) } : {}),
  };
}

export function registerScreenshotTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  assetOrigin?: string,
): void {
  // Diff baselines per render-parameter key, LRU-capped. Deliberately
  // in-memory only: a restart means components/themes may have changed
  // underneath, and a stale baseline produces confusing phantom diffs.
  const baselines = new Map<string, Baseline>();
  function rememberBaseline(key: string, value: Baseline): void {
    baselines.delete(key);
    baselines.set(key, value);
    if (baselines.size > BASELINE_CAP) {
      const oldest = baselines.keys().next().value;
      if (oldest !== undefined) baselines.delete(oldest);
    }
  }
  mcp.registerTool(
    "screenshot",
    {
      description:
        'Render a screen to PNG. mode: "light" (default) | "dark" | "compare" (side-by-side). Size via w/h (or a viewport: {w,h} object); both default to the desktop preset. fullPage defaults true. scale (0.25–1) shrinks the payload for layout checks; path ("@id" or array) captures one element; theme renders with a named theme. diff: true compares against your previous capture with the same params — zero change returns text only, small changes return a highlight crop with the changed nodes named, big changes return the new full image. resetBaseline: true re-establishes the baseline without comparing.',
      inputSchema: {
        screenId: z.string(),
        w: z.number().int().positive().optional(),
        h: z.number().int().positive().optional(),
        viewport: z
          .object({ w: z.number().int().positive(), h: z.number().int().positive() })
          .optional()
          .describe("Alternative to flat w/h; explicit w/h win if both are given"),
        mode: z.enum(["light", "dark", "compare"]).optional(),
        fullPage: z.boolean().optional(),
        scale: z.number().min(0.25).max(1).optional(),
        path: z
          .union([z.array(z.number().int().nonnegative()), z.string()])
          .optional()
          .describe('Capture only this node — path array or "@id" (not with mode: "compare")'),
        theme: z.string().optional().describe("Named theme to render with (boards pin one)"),
        diff: z.boolean().optional().describe("Compare against the previous same-params capture"),
        resetBaseline: z.boolean().optional(),
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
    }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult(`Screen not found: ${screenId}`);
      w ??= vp?.w;
      h ??= vp?.h;

      if (diff && (mode === "compare" || path !== undefined)) {
        return errorResult('screenshot: diff cannot combine with mode: "compare" or path');
      }

      let clipSelector: string | undefined;
      if (path !== undefined) {
        if (mode === "compare") {
          return errorResult('screenshot: path cannot be combined with mode: "compare"');
        }
        const resolved = resolveLocator(screen.tree, path, screenId);
        if (!resolved.ok) return errorResult(JSON.stringify(resolved.error));
        clipSelector = `[data-node-path="${resolved.value.join(".")}"]`;
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
          rememberBaseline(key, { png: capture.png, rects: capture.nodeRects });

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
          const msg = err instanceof Error ? err.message : String(err);
          if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/.test(msg)) {
            return errorResult(playwrightMissingMessage(msg));
          }
          return errorResult(`screenshot diff failed: ${msg}`);
        }
      }

      let buf: Buffer;
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
              dark: false,
            }),
            renderScreen(screen, themeByName(ctx.folder, theme), {
              viewport,
              snapshotCss,
              registry: screenRegistry,
              snippets: ctx.folder.snippets,
              customCss: ctx.folder.customCss,
              baseHref: assetOrigin,
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
            dark: mode === "dark",
          });
          buf = await screenshotBuffer({
            html,
            viewport,
            fullPage: fullPage ?? true,
            ...(scale ? { deviceScaleFactor: scale } : {}),
            ...(clipSelector ? { clipSelector } : {}),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/.test(msg)) {
          return errorResult(playwrightMissingMessage(msg));
        }
        return errorResult(`screenshot failed: ${msg}`);
      }
      return {
        content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }],
      };
    },
  );

  mcp.registerTool(
    "compare_to_url",
    {
      description:
        "Code-to-design fidelity check: render a screen and screenshot a live URL (typically the app page you're porting, on localhost) at the same viewport, then pixel-diff. Returns similarity (1 = identical), the diff regions mapped to this screen's nodes, and a side-by-side PNG — URL capture left, Velloo render right. A faithful structural port usually lands 0.85+; use the per-region node refs to find what's off. Don't chase 1.0 — fonts and image assets legitimately differ. scale defaults to 0.5 to keep payloads small. `mode: \"dark\"` renders the Velloo side dark AND best-effort drives the target page dark (prefers-color-scheme + `.dark`/`data-theme` on <html> + `localStorage.theme`) so dark fidelity checks against the app's real dark theme; an app with a bespoke theme toggle may not flip — eyeball the side-by-side.",
      inputSchema: {
        screenId: z.string(),
        url: z.string().describe("Live URL to compare against, e.g. http://localhost:3000/pricing"),
        w: z.number().int().positive().optional(),
        h: z.number().int().positive().optional(),
        viewport: z
          .object({ w: z.number().int().positive(), h: z.number().int().positive() })
          .optional()
          .describe("Alternative to flat w/h; explicit w/h win if both are given"),
        mode: z.enum(["light", "dark"]).optional(),
        fullPage: z.boolean().optional(),
        scale: z.number().min(0.25).max(1).optional().describe("Default 0.5"),
        theme: z.string().optional().describe("Named theme to render with"),
        image: z
          .boolean()
          .optional()
          .describe("Include the side-by-side PNG (default true; false = metrics only)"),
      },
    },
    async ({ screenId, url, w, h, viewport: vp, mode, fullPage, scale, theme, image }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult(`Screen not found: ${screenId}`);

      const defaults = defaultViewport(ctx.folder);
      const viewport: Viewport = { w: w ?? vp?.w ?? defaults.w, h: h ?? vp?.h ?? defaults.h };
      const scaleFactor = scale ?? 0.5;

      try {
        const snapshotCss = await jit.build();
        const { html } = await renderScreen(screen, themeByName(ctx.folder, theme), {
          viewport,
          snapshotCss,
          registry: registryForScreen(ctx, screen),
          snippets: ctx.folder.snippets,
          customCss: ctx.folder.customCss,
          baseHref: assetOrigin,
          dark: mode === "dark",
        });
        const [velloo, urlPng] = await Promise.all([
          captureScreenshot({
            html,
            viewport,
            fullPage: fullPage ?? true,
            deviceScaleFactor: scaleFactor,
          }),
          captureUrlScreenshot({
            url,
            viewport,
            fullPage: fullPage ?? true,
            deviceScaleFactor: scaleFactor,
            dark: mode === "dark",
          }),
        ]);

        const result = diffPngs(urlPng, velloo.png);
        const regions = result.regions.map((r) => ({
          ...r,
          node: regionNode(r, velloo.nodeRects, scaleFactor, screen),
        }));
        const summary = {
          similarity: Number((1 - result.changedRatio).toFixed(4)),
          changedRatio: Number(result.changedRatio.toFixed(4)),
          /** velloo render height minus URL capture height, image px. */
          heightDelta: result.heightDelta,
          regions,
        };

        const content: McpResult["content"] = [{ type: "text", text: JSON.stringify(summary) }];
        if (image !== false) {
          const side = sideBySidePng(urlPng, velloo.png);
          content.push({ type: "image", data: side.toString("base64"), mimeType: "image/png" });
        }
        return { content };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/.test(msg)) {
          return errorResult(playwrightMissingMessage(msg));
        }
        if (/net::|ERR_CONNECTION|Timeout.*exceeded|goto/.test(msg)) {
          return errorResult(
            `compare_to_url: could not load ${url} — is the app's dev server running? Underlying error: ${msg}`,
          );
        }
        return errorResult(`compare_to_url failed: ${msg}`);
      }
    },
  );

  mcp.registerTool(
    "render_snippet",
    {
      description:
        "Render a snippet in isolation and return a screenshot. Useful for iterating on a snippet's styling before stamping it. viewport defaults to 480×640.",
      inputSchema: {
        snippetId: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
        extraClassName: z.string().optional(),
        viewport: z
          .object({
            w: z.number().int().positive(),
            h: z.number().int().positive(),
          })
          .optional(),
        mode: z.enum(["light", "dark", "compare"]).optional(),
        scale: z.number().min(0.25).max(1).optional(),
        theme: z.string().optional().describe("Named theme to render with"),
      },
    },
    async ({ snippetId, args, extraClassName, viewport, mode, scale, theme }) => {
      const snippet = ctx.folder.snippets.get(snippetId);
      if (!snippet) return errorResult(`Snippet not found: ${snippetId}`);

      const vp: Viewport = viewport ?? { w: 480, h: 640 };
      const screen: Screen = {
        id: `${snippet.id}__preview`,
        name: `${snippet.name} preview`,
        tree: {
          $snippet: snippet.id,
          ...(args && Object.keys(args).length > 0 ? { args } : {}),
          ...(extraClassName && extraClassName.trim() !== ""
            ? { $extraClassName: extraClassName.trim() }
            : {}),
        },
      };

      let buf: Buffer;
      try {
        const snapshotCss = await jit.build();
        // render_snippet: a synthesized screen wraps the snippet instance
        // so registry resolution honors the snippet's library, not a stray
        // default. Wrap the synthetic screen with the snippet's library so
        // ext placeholders still merge in.
        const syntheticScreen = { ...screen, library: snippet.library };
        const screenRegistry = registryForScreen(ctx, syntheticScreen);
        if (mode === "compare") {
          const [light, dark] = await Promise.all([
            renderScreen(syntheticScreen, themeByName(ctx.folder, theme), {
              viewport: vp,
              snapshotCss,
              registry: screenRegistry,
              snippets: ctx.folder.snippets,
              customCss: ctx.folder.customCss,
              baseHref: assetOrigin,
              dark: false,
            }),
            renderScreen(syntheticScreen, themeByName(ctx.folder, theme), {
              viewport: vp,
              snapshotCss,
              registry: screenRegistry,
              snippets: ctx.folder.snippets,
              customCss: ctx.folder.customCss,
              baseHref: assetOrigin,
              dark: true,
            }),
          ]);
          buf = await screenshotCompareBuffer({
            leftHtml: light.html,
            rightHtml: dark.html,
            viewport: vp,
            ...(scale ? { deviceScaleFactor: scale } : {}),
          });
        } else {
          const { html } = await renderScreen(syntheticScreen, themeByName(ctx.folder, theme), {
            viewport: vp,
            snapshotCss,
            registry: screenRegistry,
            snippets: ctx.folder.snippets,
            customCss: ctx.folder.customCss,
            baseHref: assetOrigin,
            dark: mode === "dark",
          });
          buf = await screenshotBuffer({
            html,
            viewport: vp,
            fullPage: true,
            ...(scale ? { deviceScaleFactor: scale } : {}),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/.test(msg)) {
          return errorResult(playwrightMissingMessage(msg));
        }
        return errorResult(`render_snippet failed: ${msg}`);
      }
      return {
        content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }],
      };
    },
  );
}
