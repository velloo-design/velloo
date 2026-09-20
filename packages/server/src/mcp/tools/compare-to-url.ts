import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CaptureGeometry,
  type CaptureManifest,
  captureDir,
  captureScreenshot,
  captureUrlScreenshot,
  classifyCapture,
  cropPng,
  type DomExtract,
  diffPngs,
  downscalePng,
  isSafeCaptureId,
  pngSize,
  readCaptureManifest,
  resizePng,
  sideBySidePng,
  type UrlCaptureResult,
  type UrlCookie,
} from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { z } from "zod";
import { pinnedThemeForScreen, resolveNamedTheme } from "../../design-folder.ts";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { diagnosticsForScreen } from "../diagnostics.ts";
import { readCaptureDom, styleDiffForRegions } from "./computed.ts";
import { CompareToUrlOutput } from "./outputs.ts";
import { errorResult, type McpContent, structuredResult } from "./result.ts";
import { ThemeNameSchema, ViewportArgSchema } from "./schemas.ts";
import {
  browserErrorMessage,
  captureTimeoutMessage,
  contentHeightFromRects,
  defaultViewport,
  framesShorterThan,
  makeCanvasBundle,
  makeLiveUrl,
  mountDiagnostics,
  recordMount,
  regionNode,
  renderForCapture,
} from "./screenshot-helpers.ts";
import { type CachedUrlCapture, LruMap, planUrlCache, urlCacheKey } from "./url-capture-cache.ts";

const URL_CACHE_CAP = 20;
/** Cap the URL-capture cache's total PNG bytes (~64MB) against unbounded growth. */
const URL_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_URL_CACHE_TTL_MS = 300_000; // 5 min

export function storedCaptureRaster(
  png: Buffer,
  manifest: CaptureManifest,
  fullPage: boolean,
): { ok: true; png: Buffer } | { ok: false; message: string } {
  const screenshotMode = manifest.geometry?.screenshot?.mode;
  if (fullPage && screenshotMode === "viewport") {
    return {
      ok: false,
      message: `capture "${manifest.id}" contains only its viewport. Pass fullPage: false or make a full-page capture.`,
    };
  }
  if (!fullPage && screenshotMode !== "viewport") {
    const size = pngSize(png);
    const viewportWidth = manifest.geometry?.viewportCss.width ?? manifest.viewport.w;
    const viewportHeight = manifest.geometry?.viewportCss.height ?? manifest.viewport.h;
    const scale = viewportWidth > 0 ? size.width / viewportWidth : 1;
    const scroll = manifest.geometry?.scrollCss ?? { x: 0, y: 0 };
    return {
      ok: true,
      png: cropPng(
        png,
        {
          x: Math.round(scroll.x * scale),
          y: Math.round(scroll.y * scale),
          w: Math.round(viewportWidth * scale),
          h: Math.round(viewportHeight * scale),
        },
        0,
      ),
    };
  }
  return { ok: true, png };
}

export function storedCaptureDom(
  dom: DomExtract,
  geometry: CaptureGeometry | undefined,
  fullPage: boolean,
): DomExtract {
  if (fullPage || !geometry) return dom;
  const { x, y } = geometry.scrollCss;
  return {
    ...dom,
    viewport: { w: geometry.viewportCss.width, h: geometry.viewportCss.height },
    documentHeight: geometry.viewportCss.height,
    nodes: dom.nodes.map((node) => ({
      ...node,
      rect: { ...node.rect, x: node.rect.x - x, y: node.rect.y - y },
    })),
  };
}

/** Mirrors the renderer's {@link UrlCookie} — `satisfies` keeps the two in lockstep. */
const UrlCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  url: z.string().optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
}) satisfies z.ZodType<UrlCookie>;

/**
 * Fetch the page live. Auth, settling and caching hang off this branch on
 * purpose: all four are meaningless against a stored capture, which arrives
 * already authenticated, already settled and frozen by construction. The
 * mutual exclusion used to be prose plus a runtime check; here the schema
 * simply doesn\'t offer the combinations that do nothing.
 */
const LiveUrlSource = z.strictObject({
  url: z.string().describe("e.g. http://localhost:3000/pricing"),
  auth: z
    .strictObject({
      storageStatePath: z
        .string()
        .optional()
        .describe(
          "Playwright storage-state JSON (logged-in cookies + localStorage) — absolute, or relative to the design folder. The robust way past an auth gate.",
        ),
      cookies: z
        .array(UrlCookieSchema)
        .optional()
        .describe("Session cookies seeded before navigating (each needs url OR domain+path)"),
      localStorage: z
        .record(z.string(), z.string())
        .optional()
        .describe("localStorage entries seeded before any page script runs (e.g. a JWT)"),
    })
    .optional()
    .describe("Credentials for a page behind a login"),
  settleTimeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Max ms to wait for network quiet before capturing (default 8000). Raise it for a data-heavy page that paints a spinner first, so the shot fires once async data has settled rather than capturing the spinner (which reads as unverified).",
    ),
  cache: z
    .strictObject({
      freeze: z
        .boolean()
        .optional()
        .describe(
          "Capture the page once and diff every later call against that frozen reference. Essential for a DYNAMIC page (feed, dashboard, per-user content): without it each call re-fetches, the content drifts, and `similarity` jitters so you cannot tell a design change from a page change.",
        ),
      ttlMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("How long a frozen capture stays valid; default 300000 (5 min)"),
      refresh: z
        .boolean()
        .optional()
        .describe(
          "Re-capture now and replace the frozen reference — after fixing the target app. Implies freeze.",
        ),
    })
    .optional(),
});

/**
 * Diff against a capture already on disk (`velloo capture` /
 * `start_capture_session`). This is the way to verify a page behind a login:
 * the capture was taken in a real browser the user drove and logged into, so
 * it is authenticated by construction and identical on every call.
 */
const StoredCaptureSource = z.strictObject({
  captureId: z.string().describe("From list_captures"),
});

/**
 * The one interpretive line attached to a similarity score, or null when the
 * number speaks for itself.
 *
 * Two scores get read wrong, at opposite ends. A long single column that drifts
 * a few pixels cascades that drift downward and tanks the whole-page diff while
 * the content matches — the agent chases regions that are fine. And a score
 * near zero has no localizing power at all: the changed area is the whole page,
 * so the top region spans everything with a null node ref and merely restates
 * the score. Both readings of that second case are wrong — that the tool is
 * broken, or that structurally sound work needs tearing down — which is exactly
 * why the note has to fire hardest where the number is lowest.
 */
export function similarityNote(input: {
  similarity: number;
  contentSimilarity: number;
  heightDelta: number;
  alignedSimilarity?: number;
}): string | null {
  const { similarity, contentSimilarity, heightDelta, alignedSimilarity } = input;
  const heightDiffers = heightDelta !== 0;
  const heightDominated = heightDiffers && contentSimilarity - similarity >= 0.05;
  // A pixel diff gives no credit for being close: one rounded padding shifts a
  // column and every glyph edge under it counts. When forgiving a 1px offset
  // recovers most of the gap, the remaining work is alignment, not content.
  if (alignedSimilarity !== undefined && alignedSimilarity - similarity >= 0.02) {
    return (
      `similarity ${similarity} is mostly sub-pixel alignment: forgiving a 1px offset it is ${alignedSimilarity}. ` +
      `The content matches — what is left is a rounded spacing or line-height somewhere above, which cascades down the column. ` +
      `Chase the topMismatches nearest the top of the page; the ones below it are the same shift repeated.`
    );
  }
  if (heightDominated) {
    return (
      `similarity is held down mostly by a ${Math.abs(heightDelta)}px height difference, not by content mismatch — ` +
      `over the overlapping height the match is ${contentSimilarity}. Small cumulative vertical drift cascades down a long ` +
      `single column and tanks the whole-page pixel diff; trust contentSimilarity and the per-region node refs here.`
    );
  }
  if (similarity >= 0.3) return null;
  return (
    `similarity ${similarity} means these two renders differ structurally, not in detail. At this range the diff cannot localize: ` +
    `topMismatches will span most of the page with a null node ref, which restates the score rather than naming a cause — do not work through them yet. ` +
    (heightDiffers
      ? `The render is ${Math.abs(heightDelta)}px ${heightDelta > 0 ? "taller" : "shorter"} than the page ` +
        `(${contentSimilarity} over the overlap), which is itself the lead: at this size the gap is whole sections missing, ` +
        `stacked where the page puts them side by side, or a container a different width — not spacing. `
      : "") +
    `Re-read the capture's outline and rects (get_capture) and fix the page-level structure first; topMismatches start earning their keep past ~0.4.`
  );
}

export function registerCompareToUrlTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  assetOrigin?: string,
): void {
  const liveUrl = makeLiveUrl(ctx, bundler);
  const canvasBundle = makeCanvasBundle(ctx, canvasBundler);

  // Frozen URL captures, keyed by capture params so repeated calls on a
  // *dynamic* page diff against one stable reference instead of re-fetching
  // drifting content. In-memory + session-scoped: a restart may mean the target
  // app changed underneath.
  const urlCaptures = new LruMap<CachedUrlCapture>(URL_CACHE_CAP, {
    maxBytes: URL_CACHE_MAX_BYTES,
    sizeOf: (c) => c.result.png.byteLength,
  });

  mcp.registerTool(
    "compare_to_url",
    {
      description:
        "Code-to-design fidelity check: render a screen and capture the same page from a live URL (or a stored `captureId`) at the same viewport, then pixel-diff. 0.85+ is a faithful structural port; fix `topMismatches` in order and don't chase 1.0. `styleDiff` names the resolved computed properties behind each of those regions (design vs page) — read it instead of inferring from class strings which utility won. **If the result is `unverified` the similarity is meaningless — stop and fix the capture rather than iterating against a page you never saw.** Guide: velloo://guide/porting.",
      inputSchema: {
        screenId: z.string(),
        source: z
          .union([LiveUrlSource, StoredCaptureSource])
          .describe("What to diff against: a live page, or a capture already on disk"),
        viewport: ViewportArgSchema.optional().describe(
          "Render size; defaults to the folder's Desktop preset",
        ),
        mode: z.enum(["light", "dark"]).optional(),
        fullPage: z.boolean().optional(),
        scale: z.number().min(0.25).max(1).optional().describe("Default 0.5"),
        theme: ThemeNameSchema.describe(
          "Named theme for the Velloo side; default = the hosting board's pin, else the folder default",
        ),
        image: z
          .boolean()
          .optional()
          .describe("Include the side-by-side PNG (default true; false = metrics only)"),
      },
      outputSchema: CompareToUrlOutput,
    },
    async ({ screenId, source, viewport: vp, mode, fullPage, scale, theme, image }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult(`Screen not found: ${screenId}`);

      const live = "url" in source ? source : null;
      const url = live?.url;
      const captureId = live
        ? undefined
        : (source as z.infer<typeof StoredCaptureSource>).captureId;
      const { storageStatePath, cookies, localStorage } = live?.auth ?? {};
      const settleTimeoutMs = live?.settleTimeoutMs;
      const cache = live?.cache;

      // Match what the canvas shows: no explicit theme → the hosting board's pin.
      let themeName = theme;
      if (themeName === undefined) {
        const pinned = pinnedThemeForScreen(ctx.folder, screenId);
        if (!pinned.ok) return errorResult(pinned.message);
        themeName = pinned.name;
      }

      // A stored capture replaces the live fetch entirely: it was taken in a
      // real browser the user drove, so it is already past any login, and it
      // never drifts between calls. That makes it the durable counterpart of
      // the in-memory URL cache below — same idea, but it survives a restart.
      let storedPng: Buffer | null = null;
      let storedFinalUrl = "";
      let storedViewport: Viewport | null = null;
      let storedGeometry: CaptureGeometry | undefined;
      let storedStateId: string | undefined;
      if (captureId !== undefined) {
        if (!isSafeCaptureId(captureId)) return errorResult(`Invalid captureId: ${captureId}`);
        const folderId = ctx.folder.config.folderId;
        const manifest = readCaptureManifest(ctx.folder.root, captureId, folderId);
        if (!manifest) {
          return errorResult(
            `compare_to_url: no capture "${captureId}" for this folder — call list_captures to see what's stored.`,
          );
        }
        if (manifest.themeOnly || !manifest.files.includes("page.png")) {
          return errorResult(
            `compare_to_url: capture "${captureId}" is theme-only, so there's no page render to diff against. Capture the page itself in a capture session.`,
          );
        }
        if (manifest.stability?.status === "unstable") {
          return errorResult(
            `compare_to_url: capture "${captureId}" changed while its screenshot and outline were being recorded. Re-capture the page once it has settled; Velloo will not present mixed states as a frozen reference.`,
          );
        }
        try {
          storedPng = readFileSync(
            join(captureDir(ctx.folder.root, captureId, folderId), "page.png"),
          );
        } catch {
          return errorResult(`compare_to_url: capture "${captureId}" is missing its page.png.`);
        }
        storedFinalUrl = manifest.finalUrl || manifest.url;
        storedGeometry = manifest.geometry;
        storedStateId = manifest.stateId;
        if (manifest.viewport.w > 0) storedViewport = manifest.viewport;
        const raster = storedCaptureRaster(storedPng, manifest, fullPage !== false);
        if (!raster.ok) return errorResult(`compare_to_url: ${raster.message}`);
        storedPng = raster.png;
      } else {
        // The server navigates this URL in a real browser — restrict to http(s)
        // so `file://`, `chrome://`, and other local schemes can't be rasterized
        // and returned. Private/loopback hosts stay allowed (localhost is the
        // intended target). A stored capture is the supported way to diff
        // against something that isn't a live http(s) page.
        let scheme: string;
        try {
          scheme = new URL(url as string).protocol;
        } catch {
          return errorResult(`Invalid url: ${url}`);
        }
        if (scheme !== "http:" && scheme !== "https:") {
          return errorResult(`compare_to_url: only http(s) URLs are allowed (got ${scheme})`);
        }
      }

      const defaults = defaultViewport(ctx.folder);
      let viewport: Viewport = { w: vp?.w ?? defaults.w, h: vp?.h ?? defaults.h };
      let scaleFactor = scale ?? 0.5;
      // How far the stored PNG has to shrink to land in the same pixel space as
      // the fresh render. A capture taken in a real window is at the display's
      // device pixel ratio (2 on a Retina Mac); the render is at whatever scale
      // was asked for. Snapping the scale to a power of two keeps that ratio a
      // whole number, which is what makes the box downsample exact.
      let captureDownscale = 1;
      let captureResize: { width: number; height: number } | null = null;
      if (storedPng && storedViewport) {
        const requested = scale ?? 0.5;
        scaleFactor = [1, 0.5, 0.25].reduce((best, s) =>
          Math.abs(s - requested) < Math.abs(best - requested) ? s : best,
        );
        const storedSize = pngSize(storedPng);
        const sourceScale = storedSize.width / storedViewport.w;
        const ratio = sourceScale / scaleFactor;
        if (Number.isInteger(ratio) && ratio >= 1) {
          captureDownscale = ratio;
        } else {
          captureResize = {
            width: Math.round(storedSize.width / ratio),
            height: Math.round(storedSize.height / ratio),
          };
        }
        viewport = { w: storedViewport.w, h: storedViewport.h || defaults.h };
      }

      try {
        const snapshotCss = await jit.build();
        const _themeRes = resolveNamedTheme(ctx.folder, themeName);
        if (!_themeRes.ok) return errorResult(_themeRes.message);
        // renderForCapture mounts live-island extensions and the installed-
        // component canvas bundle on the Velloo side too — without them the
        // fidelity diff would run against static placeholders instead of the
        // user's real charts/components.
        const html = await renderForCapture(ctx, screen, {
          theme: _themeRes.theme,
          dark: mode === "dark",
          viewport,
          snapshotCss,
          liveUrl,
          canvasBundle,
          assetOrigin,
        });
        const resolvedStorageState =
          storageStatePath === undefined
            ? undefined
            : isAbsolute(storageStatePath)
              ? storageStatePath
              : join(ctx.folder.root, storageStatePath);
        const urlKey = urlCacheKey({
          url: url ?? "",
          w: viewport.w,
          h: viewport.h,
          fullPage: fullPage ?? true,
          scale: scaleFactor,
          dark: mode === "dark",
          storageStatePath: resolvedStorageState ?? null,
          cookies,
          localStorage,
        });
        const now = Date.now();
        const plan = planUrlCache({
          // A stored capture is already frozen — the live-page cache has no
          // role to play, and reporting cache state would just be noise.
          cacheUrl: storedPng === null && cache?.freeze === true,
          refreshUrl: storedPng === null && cache?.refresh === true,
          prior: urlCaptures.get(urlKey),
          now,
          ttlMs: cache?.ttlMs ?? DEFAULT_URL_CACHE_TTL_MS,
        });
        // The Velloo render is deterministic from the design JSON, so it's
        // always re-rendered (it's the side you're iterating on). Only the URL
        // capture is cached — that's the one that drifts on a dynamic page.
        const [velloo, urlCapture] = await Promise.all([
          captureScreenshot({
            html,
            viewport,
            fullPage: fullPage ?? true,
            deviceScaleFactor: scaleFactor,
            dom: true,
          }),
          storedPng
            ? Promise.resolve<UrlCaptureResult>({
                png: captureResize
                  ? resizePng(storedPng, captureResize.width, captureResize.height)
                  : downscalePng(storedPng, captureDownscale),
                finalUrl: storedFinalUrl,
                authWall: false,
                pageError: null,
              })
            : plan.reuse
              ? Promise.resolve(plan.reuse.result)
              : captureUrlScreenshot({
                  url: url as string,
                  viewport,
                  fullPage: fullPage ?? true,
                  deviceScaleFactor: scaleFactor,
                  dark: mode === "dark",
                  dom: true,
                  ...(settleTimeoutMs !== undefined ? { settleTimeoutMs } : {}),
                  ...(resolvedStorageState ? { storageStatePath: resolvedStorageState } : {}),
                  ...(cookies ? { cookies } : {}),
                  ...(localStorage ? { localStorage } : {}),
                }),
        ]);
        recordMount(canvasBundler, velloo.canvas);

        const result = diffPngs(urlCapture.png, velloo.png);
        const regions = result.regions.map((r) => ({
          ...r,
          node: regionNode(r, velloo.nodeRects, scaleFactor, screen),
        }));
        // Ranked textual rendering of the worst regions — the actionable signal for
        // text-only agents (and it survives context pruning where the JSON doesn't).
        const totalChanged = Math.max(1, result.changedPixels);
        const topMismatches = regions.slice(0, 5).map((r) => {
          const share = Math.round(((r.changedPixels ?? 0) / totalChanged) * 100);
          const node = r.node
            ? ` → ${r.node.ref ?? "node"}${r.node.id ? `#${r.node.id}` : ""} @[${r.node.path.join(",")}]`
            : "";
          return `~${share}% of the diff at (${r.x},${r.y} ${r.w}×${r.h})${node}`;
        });
        // The pixel diff says *where* the two differ; this says *what* differs
        // there. Reasoning from class strings to resolved styles is the part
        // that can't be checked, so measure both sides with the same walker
        // and report the properties that actually disagree.
        const rawReferenceDom =
          urlCapture.dom ??
          (captureId !== undefined
            ? readCaptureDom(ctx.folder.root, captureId, ctx.folder.config.folderId)
            : null);
        const referenceDom = rawReferenceDom
          ? storedCaptureDom(rawReferenceDom, storedGeometry, fullPage !== false)
          : null;
        const styleDiff =
          velloo.dom && referenceDom
            ? styleDiffForRegions(regions, velloo.dom, referenceDom, scaleFactor)
            : [];

        // An auth wall counts only when the requested page isn't itself a login
        // page (porting a login screen legitimately has a password field).
        // A stored capture cannot be an auth wall or a redirect surprise: a
        // human navigated to it and chose to capture it.
        const cls = storedPng
          ? { redirected: false, finalLooksLikeLogin: false, requestedLooksLikeLogin: false }
          : classifyCapture(url as string, urlCapture.finalUrl);
        const authWall = urlCapture.authWall && !cls.requestedLooksLikeLogin;
        const unverified = cls.redirected || authWall || urlCapture.pageError !== null;
        // Freeze only a trustworthy capture — caching an auth wall / error page
        // would pin every later diff to a broken reference and the `unverified`
        // warning would never clear. A bad capture leaves the cache untouched so
        // the next call retries fresh.
        if (plan.storeEligible && !unverified) {
          urlCaptures.set(urlKey, { result: urlCapture, capturedAt: now });
        }
        // Why the capture can't be trusted, most-specific first.
        const reason = cls.redirected
          ? `it redirected to ${urlCapture.finalUrl}`
          : urlCapture.pageError !== null
            ? urlCapture.pageError
            : "it shows a login form";
        const contentHeight = contentHeightFromRects(velloo.nodeRects);
        const shortFrames = framesShorterThan(ctx, screenId, contentHeight, viewport.w);
        const similarity = Number((1 - result.changedRatio).toFixed(4));
        const contentSimilarity = Number((1 - result.contentChangedRatio).toFixed(4));
        const bitmapHeightDelta = result.heightDelta;
        const heightDelta = Number((bitmapHeightDelta / scaleFactor).toFixed(2));
        const heightDiffers = heightDelta !== 0;
        const alignedSimilarity = Number((1 - result.alignedChangedRatio).toFixed(4));
        const note = similarityNote({
          similarity,
          contentSimilarity,
          heightDelta,
          alignedSimilarity,
        });
        const diagnostics = [
          ...(await diagnosticsForScreen(ctx, jit, screen).catch(() => [])),
          ...(await mountDiagnostics(ctx, canvasBundler, screen)),
        ];
        const summary = {
          similarity,
          changedRatio: Number(result.changedRatio.toFixed(4)),
          /** Similarity once a 1px offset is forgiven: how much of the gap is alignment. */
          ...(alignedSimilarity > similarity ? { alignedSimilarity } : {}),
          /** Similarity over only the overlapping height — height delta normalized out. */
          ...(heightDiffers ? { contentSimilarity } : {}),
          /** Velloo render height minus reference height, normalized to CSS px. */
          heightDelta,
          /** Raw raster delta retained for diagnostics. */
          bitmapHeightDelta,
          /** Velloo render's full content height in CSS px (frame-independent). */
          contentHeight,
          ...(shortFrames.length ? { framesShorterThanContent: shortFrames } : {}),
          ...(!unverified && note !== null ? { note } : {}),
          ...(storedPng
            ? {
                capture: {
                  id: captureId,
                  url: storedFinalUrl,
                  ...(storedGeometry ? { geometry: storedGeometry } : {}),
                  ...(storedStateId ? { stateId: storedStateId } : {}),
                  note: "diffed against a stored browser capture — already past any login and frozen, so similarity reflects your design changes only.",
                },
              }
            : {}),
          ...(plan.active
            ? {
                urlCache: plan.reuse
                  ? {
                      hit: true,
                      capturedAt: new Date(plan.reuse.capturedAt).toISOString(),
                      ageMs: now - plan.reuse.capturedAt,
                      note: "diffed against a frozen capture — similarity reflects design changes only, not page drift. Pass cache.refresh to re-sample.",
                    }
                  : { hit: false, stored: !unverified },
              }
            : {}),
          ...(topMismatches.length ? { topMismatches } : {}),
          ...(styleDiff.length ? { styleDiff } : {}),
          regions,
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
          ...(unverified
            ? {
                unverified: true,
                ...(cls.redirected
                  ? { redirected: { requested: url ?? "", final: urlCapture.finalUrl } }
                  : {}),
                ...(authWall ? { authWall: true } : {}),
                ...(urlCapture.pageError !== null ? { pageError: urlCapture.pageError } : {}),
                warning:
                  `the capture is NOT a faithful view of your page — ${reason}. ` +
                  "similarity is meaningless here (you're diffing against the wrong thing). " +
                  "For an auth wall, pass storageStatePath/cookies/localStorage; for a broken target, fix the app's dev server first. " +
                  "Either way, don't tune the design to this capture — leave the screen unverified.",
              }
            : {}),
        };

        const extra: McpContent[] = [];
        if (image !== false) {
          const side = sideBySidePng(urlCapture.png, velloo.png);
          extra.push({ type: "image", data: side.toString("base64"), mimeType: "image/png" });
        }
        return structuredResult(summary, ...extra);
      } catch (err) {
        const bm = browserErrorMessage(err);
        if (bm) return errorResult(bm);
        const tm = captureTimeoutMessage(err, "compare_to_url");
        if (tm) return errorResult(tm);
        const msg = err instanceof Error ? err.message : String(err);
        if (/net::|ERR_CONNECTION|Timeout.*exceeded|goto/.test(msg)) {
          return errorResult(
            `compare_to_url: could not load ${url ?? captureId} — is the app's dev server running? Underlying error: ${msg}`,
          );
        }
        return errorResult(`compare_to_url failed: ${msg}`);
      }
    },
  );
}
