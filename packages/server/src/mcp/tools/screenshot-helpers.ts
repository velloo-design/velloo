import type { FrameworkAdapter } from "@velloo/provider";
import {
  type CanvasMountState,
  type CaptureNodeRect,
  CHROMIUM_INSTALL_CMD,
  collectSerializedRefs,
  type DiffRegion,
  isCaptureTimeout,
  renderScreen,
  serializeTree,
} from "@velloo/renderer";
import {
  isArchived,
  isComponentNode,
  nodeId,
  parseRepoKey,
  type Screen,
  type Theme,
  type Viewport,
} from "@velloo/schema";
import type { CanvasBundleResult } from "../../live/canvas-bundle.ts";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import { type LiveBundler, liveExtensions } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import {
  libraryIdForScreen,
  providerForScreen,
  registryForScreen,
  renderPassForScreen,
} from "../../mutations/lookup.ts";
import { pathAt } from "../../path.ts";
import type { RepoComponents } from "../../repo/catalog.ts";
import type { DesignDiagnostic } from "../diagnostics.ts";

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

/** The client-mount wiring a render embeds: bundle URL, theme inputs, and static fallbacks. */
interface CanvasMountOption {
  url: string;
  themeOptions: unknown;
  /** What the preview entry receives: scheme, Velloo theme, each app's recipe theme. */
  preview?: unknown;
  staticRefs?: string[] | undefined;
}

export type CanvasBundleFor = (
  screen: Screen,
  theme: Theme,
  dark: boolean,
) => Promise<CanvasMountOption | undefined>;

/**
 * How a screen renders in the canvas and in every capture. A screen of
 * provider components mounts all-or-nothing: one component with no source
 * that compiles keeps the WHOLE screen on the server render. A screen with
 * repository components always mounts — each one falls back on its own.
 */
export type ScreenMount =
  /** The adapter has no browser mount, or the screen uses no components. */
  | { kind: "none" }
  | { kind: "mounted"; libraryId: string; refs: string[]; bundle: CanvasBundleResult }
  | {
      kind: "server";
      libraryId: string;
      reason: string;
      bundle?: CanvasBundleResult;
    };

export async function screenMount(
  ctx: MutationContext,
  canvasBundler: CanvasBundler,
  screen: Screen,
): Promise<ScreenMount> {
  const refs = collectSerializedRefs(serializeTree(screen.tree, { snippets: ctx.folder.snippets }));
  if (refs.length === 0) return { kind: "none" };
  const libraryId = libraryIdForScreen(ctx, screen);
  if (!canvasBundler.canMount(libraryId, refs)) return { kind: "none" };
  // See routes/render.ts: an extension ref has no browser-bundle source, so
  // the screen keeps its SSR render (plus any live-island mounts).
  const extensionIds = new Set(Object.keys(ctx.folder.config.extensions ?? {}));
  const extensions = refs.filter((ref) => extensionIds.has(ref));
  if (extensions.length > 0) {
    return {
      kind: "server",
      libraryId,
      reason: `it uses the extension${extensions.length === 1 ? "" : "s"} ${extensions.join(", ")}, which ${extensions.length === 1 ? "has" : "have"} no browser-canvas source`,
    };
  }
  const bundle = await canvasBundler.build(libraryId, refs);
  if (bundle.usable) return { kind: "mounted", libraryId, refs, bundle };
  const blocked = bundle.diagnostics.filter((entry) => entry.status === "unavailable");
  const reason = blocked.length
    ? `${blocked.map((entry) => entry.id).join(", ")} ${blocked.length === 1 ? "has" : "have"} no source that compiles for the browser`
    : `the browser bundle failed to build: ${bundle.errors[0]?.message ?? "no components resolved"}`;
  return { kind: "server", libraryId, reason, bundle };
}

/** The first error of each blocking component, trimmed — enough to act on. */
function blockingErrors(bundle: CanvasBundleResult | undefined): string[] {
  return (bundle?.diagnostics ?? [])
    .filter((entry) => entry.status === "unavailable")
    .map((entry) => {
      const first = entry.errors?.[0] ?? entry.note ?? "no browser source";
      return `${entry.id}: ${first.length > 300 ? `${first.slice(0, 300)}…` : first}`;
    });
}

/**
 * The capture-time warning that the screen is NOT rendering the app's own
 * components. Without it a screenshot of the server render reads as the app's
 * components misbehaving — a custom `size="xl"` collapsing to the bundled
 * Button's height — while `component_status` insists they are `exact`.
 */
export async function mountDiagnostics(
  ctx: MutationContext,
  canvasBundler: CanvasBundler,
  screen: Screen,
): Promise<DesignDiagnostic[]> {
  const mount = await screenMount(ctx, canvasBundler, screen).catch(() => undefined);
  if (mount?.kind !== "server") return [];
  const errors = blockingErrors(mount.bundle);
  return [
    {
      severity: "warning",
      code: "render/server-fallback",
      path: [],
      message:
        `This screen renders server-side from Velloo's bundled components, not the app's own, because ${mount.reason}. ` +
        "The browser mount is all-or-nothing, so every component on the screen falls back together — including ones component_status reports as exact." +
        (errors.length ? ` ${errors.join(" | ")}` : ""),
      suggestion:
        "Fix what blocks the listed component (component_status { screen } has the full errors), or replace it; captures will then show the app's components.",
    },
  ];
}

/**
 * A thunk yielding the framework-native canvas-bundle render option (#18) for a
 * screen — the installed-component `mountScreen` URL (root-relative; resolved
 * against the screenshot's `<base href>` like the live bundle) + native theme
 * options — or undefined when the screen stays on the server render (see
 * {@link screenMount}). Bundles are per-library, so non-default-library screens
 * mount too. Awaits the cached build so a build miss never embeds a dead URL.
 */
export function makeCanvasBundle(
  ctx: MutationContext,
  canvasBundler: CanvasBundler,
): CanvasBundleFor {
  return async (screen, theme, dark) => {
    const mount = await screenMount(ctx, canvasBundler, screen);
    if (mount.kind !== "mounted") return undefined;
    const provider = providerForScreen(ctx, screen) as FrameworkAdapter;
    const hasRepo = mount.refs.some((ref) => ref.startsWith("repo:"));
    return {
      url:
        `/api/canvas/bundle.js?v=${canvasBundler.version}&lib=${encodeURIComponent(mount.libraryId)}` +
        `&refs=${encodeURIComponent(mount.refs.join(","))}`,
      themeOptions: provider.themeToNative?.(theme, dark) ?? null,
      ...(hasRepo && ctx.repo ? { preview: previewInput(ctx.repo, mount.refs, theme, dark) } : {}),
      ...(mount.bundle.staticRefs ? { staticRefs: mount.bundle.staticRefs } : {}),
    };
  };
}

/**
 * The props every preview entry receives: the frame's scheme, the Velloo
 * theme, and per app the theme its framework recipe projects from those
 * tokens — so editing the Velloo theme restyles the app's components too.
 */
function previewInput(repo: RepoComponents, refs: string[], theme: Theme, dark: boolean): unknown {
  const apps = new Set(
    refs.filter((ref) => ref.startsWith("repo:")).map((ref) => parseRepoKey(ref)?.app),
  );
  const recipeTheme: Record<string, unknown> = {};
  for (const app of apps) {
    const entry = repo.preview(app);
    const recipe = entry.kind === "recipe" ? entry.recipe : repo.recipes(app)[0];
    if (recipe) recipeTheme[app ?? ""] = recipe.themeToNative(theme, dark);
  }
  return { colorScheme: dark ? "dark" : "light", theme, recipeTheme };
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
  const id = nodeId(node);
  return {
    path,
    ...(isComponentNode(node) ? { ref: node.$ref } : {}),
    ...(id !== undefined ? { id } : {}),
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

/**
 * What a capture actually showed for the app's own components: a fidelity
 * count and each one that wasn't exact, with its reason. Screenshot metadata,
 * so a picture of a proxy is never read as the real component.
 */
export function mountSummary(canvas: CanvasMountState | undefined):
  | {
      mounted: boolean;
      fidelity: Record<string, number>;
      notExact: { name: string; status: string; code?: string; note?: string }[];
    }
  | undefined {
  const repo = (canvas?.diagnostics ?? []).filter((entry) => entry.id.startsWith("repo:"));
  if (!canvas || repo.length === 0) return undefined;
  const fidelity: Record<string, number> = {};
  for (const entry of repo) fidelity[entry.status] = (fidelity[entry.status] ?? 0) + 1;
  return {
    mounted: canvas.mounted,
    fidelity,
    notExact: repo
      .filter((entry) => entry.status !== "exact")
      .map((entry) => ({
        name: entry.name ?? entry.id,
        status: entry.status,
        ...(entry.code ? { code: entry.code } : {}),
        ...(entry.note ? { note: entry.note } : {}),
      })),
  };
}

/**
 * File what a capture's mount found at runtime with the bundler, so
 * `component_status` reports it too. Capture pages have an opaque origin and
 * can't post it back themselves; the canvas iframe's own reports arrive by
 * beacon.
 */
export function recordMount(
  canvasBundler: CanvasBundler,
  canvas: CanvasMountState | undefined,
): void {
  if (canvas?.bundle) canvasBundler.recordRuntime(canvas.bundle, canvas.diagnostics);
}
