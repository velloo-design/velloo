import type { FrameworkAdapter } from "@velloo/provider";
import {
  type CaptureNodeRect,
  CHROMIUM_INSTALL_CMD,
  type DiffRegion,
  isCaptureTimeout,
  renderScreen,
} from "@velloo/renderer";
import {
  isArchived,
  isComponentNode,
  nodeId,
  type Screen,
  type Theme,
  type Viewport,
} from "@velloo/schema";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import { type LiveBundler, liveExtensions } from "../../live/component-bundler.ts";
import { updateFrame } from "../../mutations/api/frames.ts";
import type { MutationContext } from "../../mutations/index.ts";
import {
  libraryIdForScreen,
  providerForScreen,
  registryForScreen,
  renderPassForScreen,
} from "../../mutations/lookup.ts";
import { pathAt } from "../../path.ts";

function playwrightMissingMessage(msg: string): string {
  return `screenshot: Playwright is not installed. Run \`${CHROMIUM_INSTALL_CMD}\`, then retry — no server restart needed. Underlying error: ${msg}`;
}

/**
 * An actionable message for a capture *rasterize* stall (a `page.screenshot` /
 * `setContent` timeout), or null. Scoped to those steps via the message text so
 * a `goto` timeout in `compare_to_url` still falls through to its own
 * dev-server hint instead of this generic render-stall one.
 */
export function captureTimeoutMessage(err: unknown, op: string): string | null {
  if (!isCaptureTimeout(err)) return null;
  const msg = err instanceof Error ? err.message : "";
  if (!/screenshot|setContent/i.test(msg)) return null;
  return (
    `${op} timed out rendering the page (capped at 20s). This is almost always a one-off render ` +
    `stall — a cold web-font fetch or a first heavy paint — so retry; it usually clears. If it ` +
    `persists, the page has expensive CSS (a large repeating background, heavy blur/shadow) or is ` +
    `very tall: simplify the heavy styles, or capture a smaller region/viewport.`
  );
}

/**
 * A friendly one-line message for a browser/Playwright failure, or null if
 * `err` isn't one. `BrowserMissingError` already carries an actionable message
 * (missing install or a collapsed launch-crash summary) — surface it verbatim
 * rather than dumping the raw multi-line browser log.
 */
export function browserErrorMessage(err: unknown): string | null {
  if (err instanceof Error && err.name === "BrowserMissingError") return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/i.test(msg)) {
    return playwrightMissingMessage(msg.split("\n")[0] ?? msg);
  }
  return null;
}

export function defaultViewport(folder: {
  config: { viewportPresets: Array<{ name: string; w: number; h: number }> };
}): Viewport {
  // Prefer Desktop, fall back to first preset.
  const presets = folder.config.viewportPresets;
  const desktop = presets.find((p) => p.name.toLowerCase().includes("desktop"));
  const pick = desktop ?? presets[0] ?? { w: 1440, h: 900 };
  return { w: pick.w, h: pick.h };
}

/**
 * A thunk yielding the root-relative live-island bundle URL (served by the
 * canvas server at `assetOrigin`), or undefined when the folder has no
 * `render:"live"` extensions. Re-evaluated per render so a fresh bundle version
 * is picked up after a host edit.
 */
export function makeLiveUrl(ctx: MutationContext, bundler: LiveBundler): () => string | undefined {
  return () =>
    Object.keys(liveExtensions(ctx.folder.config.extensions)).length > 0
      ? `/api/live/bundle.js?v=${bundler.version}`
      : undefined;
}

export type CanvasBundleFor = (
  screen: Pick<Screen, "library">,
  theme: Theme,
  dark: boolean,
) => Promise<{ url: string; themeOptions: unknown } | undefined>;

/**
 * A thunk yielding the framework-native canvas-bundle render option (#18) for a
 * screen — the installed-component `mountScreen` URL (root-relative; resolved
 * against the screenshot's `<base href>` like the live bundle) + native theme
 * options — or undefined when the screen's adapter declares no bundle spec OR
 * the build failed (framework not installed). Both keep the capture on SSR;
 * bundles are per-library, so non-default-library screens mount too.
 * Awaits the cached build so a build miss never embeds a dead URL.
 */
export function makeCanvasBundle(
  ctx: MutationContext,
  canvasBundler: CanvasBundler,
): CanvasBundleFor {
  return async (screen, theme, dark) => {
    const provider = providerForScreen(ctx, screen) as FrameworkAdapter;
    if (!provider.canvasBundleSpec || !provider.themeToNative) return undefined;
    const libraryId = libraryIdForScreen(ctx, screen);
    const { errors } = await canvasBundler.build(libraryId);
    if (errors.length > 0) return undefined;
    return {
      url: `/api/canvas/bundle.js?v=${canvasBundler.version}&lib=${encodeURIComponent(libraryId)}`,
      themeOptions: provider.themeToNative(theme, dark),
    };
  };
}

export interface CaptureRenderOptions {
  theme: Theme;
  dark: boolean;
  viewport: Viewport;
  snapshotCss: string;
  liveUrl: () => string | undefined;
  canvasBundle: CanvasBundleFor;
  assetOrigin?: string | undefined;
}

/**
 * The one renderScreen call behind `screenshot` / `compare_to_url` /
 * `render_snippet`: resolves the screen's registry + render pass + canvas
 * bundle for the requested variant ONLY — a compare capture calls it twice
 * (light, dark) instead of every path paying for both.
 */
export async function renderForCapture(
  ctx: MutationContext,
  screen: Screen,
  opts: CaptureRenderOptions,
): Promise<string> {
  const canvasOpt = await opts.canvasBundle(screen, opts.theme, opts.dark);
  const { html } = await renderScreen(screen, opts.theme, {
    viewport: opts.viewport,
    snapshotCss: opts.snapshotCss,
    registry: registryForScreen(ctx, screen),
    renderPass: renderPassForScreen(ctx, screen, opts.theme, opts.dark),
    snippets: ctx.folder.snippets,
    customCss: ctx.folder.customCss,
    baseHref: opts.assetOrigin,
    liveBundleUrl: opts.liveUrl(),
    dark: opts.dark,
    ...(canvasOpt ? { canvasBundle: canvasOpt } : {}),
  });
  return html;
}

/** Region → deepest node mapping. Rects are CSS px; regions are image px. */
export function regionNode(
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

/** Tallest extent of any measured node, in CSS px — the screen's rendered content height. */
export function contentHeightFromRects(rects: CaptureNodeRect[]): number {
  let max = 0;
  for (const r of rects) max = Math.max(max, r.y + r.h);
  return Math.round(max);
}

export interface FrameOverflow {
  board: string;
  frame: string;
  label?: string;
  frameHeight: number;
  overflowBy: number;
}

/**
 * Board frames pointing at `screenId` whose fixed height is shorter than the
 * screen's rendered content — i.e. the board view clips them below the fold.
 * `screenshot`/`compare_to_url` render the full natural height (`fullPage`), so
 * this is the only signal an agent gets that a placement needs resizing.
 *
 * Content height is width-dependent (a 390px render is far taller than the
 * same screen at 1440px), so only frames whose width matches the capture
 * viewport are considered — fitting a desktop frame to a mobile capture's
 * height would mis-grow it.
 */
export function framesShorterThan(
  ctx: MutationContext,
  screenId: string,
  contentHeight: number,
  viewportW: number,
): FrameOverflow[] {
  const out: FrameOverflow[] = [];
  for (const board of ctx.folder.boards.values()) {
    // Overflow is an advisory to act on; an archived board's frames are
    // noise the agent shouldn't be resizing.
    if (isArchived(board)) continue;
    for (const frame of board.frames) {
      if (frame.screen === screenId && frame.w === viewportW && frame.h < contentHeight) {
        out.push({
          board: board.id,
          frame: frame.id,
          ...(frame.label ? { label: frame.label } : {}),
          frameHeight: frame.h,
          overflowBy: contentHeight - frame.h,
        });
      }
    }
  }
  return out;
}

export interface FittedFrame {
  board: string;
  frame: string;
  from: number;
  to: number;
}

/**
 * Resize every clipping frame up to the rendered content height — the auto-fit
 * counterpart of `framesShorterThan`. Lets `fitFrames: true` close the loop in
 * one call instead of the agent reading the overflow list and firing
 * `update_frame` per placement.
 */
export async function fitFramesToContent(
  ctx: MutationContext,
  shortFrames: FrameOverflow[],
  contentHeight: number,
): Promise<FittedFrame[]> {
  const fitted: FittedFrame[] = [];
  for (const f of shortFrames) {
    const r = await updateFrame(ctx, {
      boardId: f.board,
      frameId: f.frame,
      patch: { h: contentHeight },
    });
    if (r.ok) {
      fitted.push({ board: f.board, frame: f.frame, from: f.frameHeight, to: contentHeight });
    }
  }
  return fitted;
}
