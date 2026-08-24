import { isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  captureScreenshot,
  captureUrlScreenshot,
  classifyCapture,
  diffPngs,
  renderScreen,
  sideBySidePng,
  type UrlCookie,
} from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { registryForScreen, renderPassForScreen } from "../../mutations/lookup.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { resolveViewport, ThemeNameSchema, ViewportSchema } from "./schemas.ts";
import {
  browserErrorMessage,
  captureTimeoutMessage,
  contentHeightFromRects,
  defaultViewport,
  errorResult,
  fitFramesToContent,
  framesShorterThan,
  type McpResult,
  makeCanvasBundle,
  makeLiveUrl,
  regionNode,
} from "./screenshot-helpers.ts";
import { type CachedUrlCapture, LruMap, planUrlCache, urlCacheKey } from "./url-capture-cache.ts";

const URL_CACHE_CAP = 20;
const DEFAULT_URL_CACHE_TTL_MS = 300_000; // 5 min

/** Mirrors the renderer's {@link UrlCookie} — `satisfies` keeps the two in lockstep. */
const UrlCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  url: z.string().optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
}) satisfies z.ZodType<UrlCookie>;

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
  const urlCaptures = new LruMap<CachedUrlCapture>(URL_CACHE_CAP);

  mcp.registerTool(
    "compare_to_url",
    {
      description:
        "Code-to-design fidelity check: render a screen and screenshot a live URL (typically the app page you're porting, on localhost) at the same viewport, then pixel-diff. Returns similarity (1 = identical), the diff regions mapped to this screen's nodes, and a side-by-side PNG — URL capture left, Velloo render right. A faithful structural port usually lands 0.85+; use the per-region node refs to find what's off. Don't chase 1.0 — fonts and image assets legitimately differ. scale defaults to 0.5 to keep payloads small. `mode: \"dark\"` renders the Velloo side dark AND best-effort drives the target page dark (prefers-color-scheme + `.dark`/`data-theme` on <html> + `localStorage.theme`) so dark fidelity checks against the app's real dark theme; an app with a bespoke theme toggle may not flip — eyeball the side-by-side. **When the capture isn't your page**, the result carries `unverified: true` and the similarity is meaningless — do NOT trust it or iterate against it. Causes: `redirected`/`authWall` (the URL bounced to a login page — pass `storageStatePath`, a Playwright storage-state JSON with the logged-in session, or `cookies`/`localStorage` to reach the real page), or `pageError` (the target app is throwing a dev error overlay / rendered blank — fix the app's dev server first). One common false blank: a data-heavy page that paints a loading spinner before its async data arrives — bump `settleTimeoutMs` (default 8000) so the capture waits for it to settle. If you can't get a real capture, leave the screen unverified rather than tuning it to a page you never actually saw. For a DYNAMIC page whose content changes between loads (feed, dashboard, per-user content), pass `cacheUrl: true` so repeated calls diff against ONE frozen capture instead of drifting live content — otherwise `similarity` jitters and you can't separate design changes from page changes. Bound staleness with `urlCacheTtlMs` (default 300000), and re-sample with `refreshUrl: true` after you've changed the target app.",
      inputSchema: {
        screenId: z.string(),
        url: z.string().describe("Live URL to compare against, e.g. http://localhost:3000/pricing"),
        w: z.number().int().positive().optional(),
        h: z.number().int().positive().optional(),
        viewport: ViewportSchema.optional().describe(
          "Alternative to flat w/h; explicit w/h win if both are given",
        ),
        mode: z.enum(["light", "dark"]).optional(),
        fullPage: z.boolean().optional(),
        scale: z.number().min(0.25).max(1).optional().describe("Default 0.5"),
        theme: ThemeNameSchema,
        storageStatePath: z
          .string()
          .optional()
          .describe(
            "Path to a Playwright storage-state JSON (logged-in cookies + localStorage) — absolute, or relative to the design folder. The robust way past auth gates.",
          ),
        cookies: z
          .array(UrlCookieSchema)
          .optional()
          .describe("Session cookies to seed before navigating (each needs url OR domain+path)"),
        localStorage: z
          .record(z.string(), z.string())
          .optional()
          .describe("localStorage entries seeded before any page script runs (e.g. a JWT)"),
        settleTimeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Max ms to wait for network quiet before capturing (default 8000). Raise it for data-heavy pages that paint a loading spinner first, so the shot fires once async data/charts have settled instead of capturing the spinner (which reads as a blank/unverified page).",
          ),
        cacheUrl: z
          .boolean()
          .optional()
          .describe(
            "Reuse a frozen capture of this URL across calls instead of re-fetching every time. Essential for DYNAMIC pages (feeds, dashboards, per-user content): without it, each call hits the live page and its content drifts, so `similarity` jitters and you can't tell design changes from page changes. With it, the first call captures the page once and every later call (same url + viewport + scale + mode + auth) diffs against that frozen reference. Default false.",
          ),
        urlCacheTtlMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "How long a cached URL capture stays valid, ms (default 300000 = 5 min). Only applies with cacheUrl. Raise it to freeze a reference for a long iteration session; lower it to re-sample a slowly-changing page periodically.",
          ),
        refreshUrl: z
          .boolean()
          .optional()
          .describe(
            "Force a fresh capture and replace the cached reference (re-establish the frozen baseline) — use after you've fixed the target app or want a new sample. Implies caching. Default false.",
          ),
        image: z
          .boolean()
          .optional()
          .describe("Include the side-by-side PNG (default true; false = metrics only)"),
        fitFrames: z
          .boolean()
          .optional()
          .describe(
            "Resize any board frame that clips this screen up to its content height (returns `fittedFrames`). Default false.",
          ),
      },
    },
    async ({
      screenId,
      url,
      w,
      h,
      viewport: vp,
      mode,
      fullPage,
      scale,
      theme,
      storageStatePath,
      cookies,
      localStorage,
      settleTimeoutMs,
      cacheUrl,
      urlCacheTtlMs,
      refreshUrl,
      image,
      fitFrames,
    }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult(`Screen not found: ${screenId}`);

      const defaults = defaultViewport(ctx.folder);
      const resolved = resolveViewport(w, h, vp);
      const viewport: Viewport = { w: resolved.w ?? defaults.w, h: resolved.h ?? defaults.h };
      const scaleFactor = scale ?? 0.5;

      try {
        const snapshotCss = await jit.build();
        const resolvedTheme = themeByName(ctx.folder, theme);
        const canvasOpt = await canvasBundle(screen, resolvedTheme, mode === "dark");
        const { html } = await renderScreen(screen, resolvedTheme, {
          viewport,
          snapshotCss,
          registry: registryForScreen(ctx, screen),
          renderPass: renderPassForScreen(ctx, screen, resolvedTheme),
          snippets: ctx.folder.snippets,
          customCss: ctx.folder.customCss,
          baseHref: assetOrigin,
          // Mount live-island extensions (real host charts &c.) on the Velloo
          // side too — without this the fidelity diff is against static
          // placeholders, which `screenshot`/`render_snippet` already avoid.
          liveBundleUrl: liveUrl(),
          dark: mode === "dark",
          // Compare against the user's EXACT installed components when available
          // (#18) — apples-to-apples fidelity vs the live app.
          ...(canvasOpt ? { canvasBundle: canvasOpt } : {}),
        });
        const resolvedStorageState =
          storageStatePath === undefined
            ? undefined
            : isAbsolute(storageStatePath)
              ? storageStatePath
              : join(ctx.folder.root, storageStatePath);
        const urlKey = urlCacheKey({
          url,
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
          cacheUrl: cacheUrl === true,
          refreshUrl: refreshUrl === true,
          prior: urlCaptures.get(urlKey),
          now,
          ttlMs: urlCacheTtlMs ?? DEFAULT_URL_CACHE_TTL_MS,
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
          }),
          plan.reuse
            ? Promise.resolve(plan.reuse.result)
            : captureUrlScreenshot({
                url,
                viewport,
                fullPage: fullPage ?? true,
                deviceScaleFactor: scaleFactor,
                dark: mode === "dark",
                ...(settleTimeoutMs !== undefined ? { settleTimeoutMs } : {}),
                ...(resolvedStorageState ? { storageStatePath: resolvedStorageState } : {}),
                ...(cookies ? { cookies } : {}),
                ...(localStorage ? { localStorage } : {}),
              }),
        ]);

        const result = diffPngs(urlCapture.png, velloo.png);
        const regions = result.regions.map((r) => ({
          ...r,
          node: regionNode(r, velloo.nodeRects, scaleFactor, screen),
        }));
        // An auth wall counts only when the requested page isn't itself a login
        // page (porting a login screen legitimately has a password field).
        const cls = classifyCapture(url, urlCapture.finalUrl);
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
        const shortFrames = framesShorterThan(ctx, screenId, contentHeight);
        // Fit against the Velloo render's height — independent of whether the
        // URL capture verified, so it's safe even on an unverified diff.
        const fitted =
          fitFrames && shortFrames.length
            ? await fitFramesToContent(ctx, shortFrames, contentHeight)
            : [];
        const similarity = Number((1 - result.changedRatio).toFixed(4));
        const contentSimilarity = Number((1 - result.contentChangedRatio).toFixed(4));
        const heightDiffers = result.heightDelta !== 0;
        // The headline pixel-diff over the union over-counts a length mismatch:
        // on a tall single column, a few px of cumulative drift cascades and
        // sinks `similarity` even when the content matches. Flag it when the
        // overlap-only score is materially better so the agent trusts the
        // structural match (and the per-region node refs) over the headline.
        const heightDominated = heightDiffers && contentSimilarity - similarity >= 0.05;
        const summary = {
          similarity,
          changedRatio: Number(result.changedRatio.toFixed(4)),
          /** Similarity over only the overlapping height — height delta normalized out. */
          ...(heightDiffers ? { contentSimilarity } : {}),
          /** velloo render height minus URL capture height, image px. */
          heightDelta: result.heightDelta,
          /** Velloo render's full content height in CSS px (frame-independent). */
          contentHeight,
          ...(fitted.length
            ? { fittedFrames: fitted }
            : shortFrames.length
              ? { framesShorterThanContent: shortFrames }
              : {}),
          ...(!unverified && heightDominated
            ? {
                note:
                  `similarity is held down mostly by a ${Math.abs(result.heightDelta)}px height difference, not by content mismatch — ` +
                  `over the overlapping height the match is ${contentSimilarity}. Small cumulative vertical drift cascades down a long ` +
                  `single column and tanks the whole-page pixel diff; trust contentSimilarity and the per-region node refs here.`,
              }
            : {}),
          ...(plan.active
            ? {
                urlCache: plan.reuse
                  ? {
                      hit: true,
                      capturedAt: new Date(plan.reuse.capturedAt).toISOString(),
                      ageMs: now - plan.reuse.capturedAt,
                      note: "diffed against a frozen capture — similarity reflects design changes only, not page drift. Pass refreshUrl: true to re-sample.",
                    }
                  : { hit: false, stored: !unverified },
              }
            : {}),
          regions,
          ...(unverified
            ? {
                unverified: true,
                ...(cls.redirected
                  ? { redirected: { requested: url, final: urlCapture.finalUrl } }
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

        const content: McpResult["content"] = [{ type: "text", text: JSON.stringify(summary) }];
        if (image !== false) {
          const side = sideBySidePng(urlCapture.png, velloo.png);
          content.push({ type: "image", data: side.toString("base64"), mimeType: "image/png" });
        }
        return { content };
      } catch (err) {
        const bm = browserErrorMessage(err);
        if (bm) return errorResult(bm);
        const tm = captureTimeoutMessage(err, "compare_to_url");
        if (tm) return errorResult(tm);
        const msg = err instanceof Error ? err.message : String(err);
        if (/net::|ERR_CONNECTION|Timeout.*exceeded|goto/.test(msg)) {
          return errorResult(
            `compare_to_url: could not load ${url} — is the app's dev server running? Underlying error: ${msg}`,
          );
        }
        return errorResult(`compare_to_url failed: ${msg}`);
      }
    },
  );
}
