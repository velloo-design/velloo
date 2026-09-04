import type { ComponentProvider } from "@velloo/provider";
import {
  buildBoardComposite,
  captureScreenshot,
  type PdfPageOptions,
  pdfDeckBuffer,
  pdfPageBuffer,
  renderScreen,
  screenshotCompareBuffer,
} from "@velloo/renderer";
import type { Board, Frame, Screen, Theme, Viewport } from "@velloo/schema";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { registryForScreen, renderPassForScreen } from "../extensions/registry.ts";
import { inlineStandaloneDocument, type StandaloneResult, sizeWarning } from "./standalone.ts";

/**
 * The shared export core: frame/board/screen → PNG, PDF, standalone
 * HTML. Everything renders through the per-screen adapter (registry + render
 * pass), so shadcn (Tailwind), MUI (emotion SSR), and none folders all export
 * in their native idiom. Consumed by the daemon's /api/export routes and by
 * `velloo export` — both build an {@link ExportPipeline} and call the same
 * functions, so the two surfaces cannot drift.
 */

export type ExportMode = "light" | "dark" | "compare";
export type ExportFormat = "png" | "pdf" | "html";

export interface ExportPipeline {
  folder: DesignFolder;
  providers: Record<string, ComponentProvider>;
  defaultProvider: ComponentProvider;
  snapshotCss: () => Promise<string>;
  /**
   * Origin Playwright pages resolve /assets/… against during PNG/PDF capture,
   * or undefined when the export has no origin yet (a standalone bundle, or a
   * caller that starts its asset server lazily) — the callback is consulted
   * per render, so it can begin unset.
   */
  assetOrigin?: (() => string | undefined) | undefined;
  /** Live-island bundle URL for captures (daemon only); undefined when the folder has no live islands. */
  liveBundleUrl?: (() => string | undefined) | undefined;
  /** Installed-component client mount for captures (daemon only, #18). */
  canvasBundleFor?: (
    screen: Screen,
    theme: Theme,
    dark: boolean,
  ) => Promise<{ url: string; themeOptions: unknown } | undefined>;
}

export interface ExportOptions {
  mode?: ExportMode | undefined;
  /** Device scale factor for PNG output (retina); clamped by the surfaces. */
  scale?: number | undefined;
  /** Named theme override; default = the board's pin (frames/boards) or the folder default. */
  theme?: string | undefined;
}

/** Find a frame by id across every board. Frame ids are unique per folder. */
export function findFrame(
  folder: DesignFolder,
  frameId: string,
): { board: Board; frame: Frame } | null {
  for (const board of folder.boards.values()) {
    const frame = board.frames.find((f) => f.id === frameId);
    if (frame) return { board, frame };
  }
  return null;
}

/** Filesystem-safe artifact stem from a design name/id. */
export function exportFilename(name: string, ext: ExportFormat): string {
  const stem = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `${stem}.${ext}`;
}

interface RenderHtmlOptions {
  dark: boolean;
  themeName?: string | undefined;
  viewport: Viewport;
  /** Standalone documents carry no runtime script, live bundle, or client mount. */
  standalone?: boolean | undefined;
}

async function renderExportHtml(
  p: ExportPipeline,
  screen: Screen,
  opts: RenderHtmlOptions,
): Promise<string> {
  const theme = themeByName(p.folder, opts.themeName);
  const config = p.folder.config;
  const canvasBundle = opts.standalone
    ? undefined
    : await p.canvasBundleFor?.(screen, theme, opts.dark);
  const baseHref = opts.standalone ? undefined : p.assetOrigin?.();
  const liveBundleUrl = opts.standalone ? undefined : p.liveBundleUrl?.();
  const { html } = await renderScreen(screen, theme, {
    viewport: opts.viewport,
    snapshotCss: await p.snapshotCss(),
    registry: registryForScreen(
      screen,
      p.providers,
      p.defaultProvider,
      config.extensions ?? {},
      config.styling?.framework,
    ),
    renderPass: renderPassForScreen(screen, p.providers, p.defaultProvider, theme, opts.dark),
    snippets: p.folder.snippets,
    customCss: p.folder.customCss,
    dark: opts.dark,
    ...(baseHref ? { baseHref } : {}),
    ...(liveBundleUrl ? { liveBundleUrl } : {}),
    ...(canvasBundle ? { canvasBundle } : {}),
    ...(opts.standalone ? { includeRuntime: false } : {}),
  });
  return html;
}

const themeOf = (board: Board, override?: string): string | undefined => override ?? board.theme;

/** The frame's screen, or throw — routes turn this into a 404 upstream via findFrame. */
function screenOf(p: ExportPipeline, frame: Frame): Screen {
  const screen = p.folder.screens.get(frame.screen);
  if (!screen) throw new Error(`frame "${frame.id}" points at missing screen "${frame.screen}"`);
  return screen;
}

/**
 * Frame → PNG at the frame's viewport, clipped to the frame rect (what the
 * canvas shows — `velloo render`/screen exports keep fullPage semantics).
 * mode "compare" renders light|dark side by side.
 */
export async function exportFramePng(
  p: ExportPipeline,
  board: Board,
  frame: Frame,
  opts: ExportOptions = {},
): Promise<Buffer> {
  const screen = screenOf(p, frame);
  const viewport: Viewport = { w: frame.w, h: frame.h };
  const themeName = themeOf(board, opts.theme);
  const scale = opts.scale ?? 1;
  if (opts.mode === "compare") {
    const [light, dark] = await Promise.all([
      renderExportHtml(p, screen, { dark: false, themeName, viewport }),
      renderExportHtml(p, screen, { dark: true, themeName, viewport }),
    ]);
    return screenshotCompareBuffer({
      leftHtml: light,
      rightHtml: dark,
      viewport,
      deviceScaleFactor: scale,
    });
  }
  const html = await renderExportHtml(p, screen, {
    dark: opts.mode === "dark",
    themeName,
    viewport,
  });
  const { png } = await captureScreenshot({
    html,
    viewport,
    fullPage: false,
    deviceScaleFactor: scale,
  });
  return png;
}

/**
 * Board → one composite PNG matching the canvas layout: frames at their board
 * coordinates as srcdoc iframes, labeled, CSS-downscaled past
 * BOARD_COMPOSITE_MAX_WIDTH (the explicit huge-board strategy — `scale` then
 * multiplies the raster density back up for retina output).
 */
export async function exportBoardPng(
  p: ExportPipeline,
  board: Board,
  opts: ExportOptions = {},
): Promise<Buffer> {
  const composite = await boardComposite(p, board, opts, false);
  const { png } = await captureScreenshot({
    html: composite.html,
    viewport: composite.viewport,
    fullPage: false,
    deviceScaleFactor: opts.scale ?? 1,
  });
  return png;
}

/**
 * Frame → single-page PDF at the frame's viewport. Tall content grows the
 * page (fullPage semantics, matching the screenshot pipeline) so a frame is
 * always exactly one page — nothing clips, nothing paginates.
 */
export async function exportFramePdf(
  p: ExportPipeline,
  board: Board,
  frame: Frame,
  opts: ExportOptions = {},
): Promise<Buffer> {
  const screen = screenOf(p, frame);
  const viewport: Viewport = { w: frame.w, h: frame.h };
  const html = await renderExportHtml(p, screen, {
    dark: opts.mode === "dark",
    themeName: themeOf(board, opts.theme),
    viewport,
  });
  return pdfPageBuffer({ html, viewport });
}

/**
 * Board → multi-page PDF deck: one frame per page in board (frames array)
 * order, each page sized to that frame's viewport and labeled with the frame
 * label / screen name — a review deck a stakeholder flips through without
 * velloo.
 */
export async function exportBoardPdf(
  p: ExportPipeline,
  board: Board,
  opts: ExportOptions = {},
): Promise<Buffer> {
  const dark = opts.mode === "dark";
  const themeName = themeOf(board, opts.theme);
  const pages: PdfPageOptions[] = [];
  for (const frame of board.frames) {
    const screen = p.folder.screens.get(frame.screen);
    if (!screen) continue;
    const viewport: Viewport = { w: frame.w, h: frame.h };
    pages.push({
      html: await renderExportHtml(p, screen, { dark, themeName, viewport }),
      viewport,
      label: frame.label ?? screen.name ?? screen.id,
    });
  }
  if (pages.length === 0) throw new Error(`board "${board.id}" has no exportable frames`);
  return pdfDeckBuffer(pages);
}

/**
 * Screen → self-contained standalone HTML (opens from file:// with no server):
 * CSS is already inline in the document; referenced /assets/… become data
 * URIs and Google Fonts are embedded (see standalone.ts). Live islands and
 * canvas affordances degrade to their static SSR — no script references.
 */
export async function exportScreenHtml(
  p: ExportPipeline,
  screen: Screen,
  opts: { dark?: boolean; theme?: string; viewport: Viewport },
): Promise<StandaloneResult> {
  const html = await renderExportHtml(p, screen, {
    dark: opts.dark ?? false,
    themeName: opts.theme,
    viewport: opts.viewport,
    standalone: true,
  });
  return inlineStandaloneDocument(html, { assetRoot: p.folder.root });
}

/**
 * Screen → PNG/PDF outside any frame (the CLI's screen target): rendered at
 * an explicit viewport with fullPage semantics — content taller than the
 * viewport grows the capture, mirroring `velloo render` and the MCP
 * screenshot default.
 */
export async function exportScreenPng(
  p: ExportPipeline,
  screen: Screen,
  opts: { mode?: ExportMode; scale?: number; theme?: string; viewport: Viewport },
): Promise<Buffer> {
  const { viewport } = opts;
  if (opts.mode === "compare") {
    const [light, dark] = await Promise.all([
      renderExportHtml(p, screen, { dark: false, themeName: opts.theme, viewport }),
      renderExportHtml(p, screen, { dark: true, themeName: opts.theme, viewport }),
    ]);
    return screenshotCompareBuffer({
      leftHtml: light,
      rightHtml: dark,
      viewport,
      deviceScaleFactor: opts.scale ?? 1,
    });
  }
  const html = await renderExportHtml(p, screen, {
    dark: opts.mode === "dark",
    themeName: opts.theme,
    viewport,
  });
  const { png } = await captureScreenshot({
    html,
    viewport,
    fullPage: true,
    deviceScaleFactor: opts.scale ?? 1,
  });
  return png;
}

export async function exportScreenPdf(
  p: ExportPipeline,
  screen: Screen,
  opts: { mode?: ExportMode; theme?: string; viewport: Viewport },
): Promise<Buffer> {
  const html = await renderExportHtml(p, screen, {
    dark: opts.mode === "dark",
    themeName: opts.theme,
    viewport: opts.viewport,
  });
  return pdfPageBuffer({ html, viewport: opts.viewport });
}

/** Frame → standalone HTML: its screen at the frame's viewport + board theme. */
export async function exportFrameHtml(
  p: ExportPipeline,
  board: Board,
  frame: Frame,
  opts: ExportOptions = {},
): Promise<StandaloneResult> {
  const screen = screenOf(p, frame);
  return exportScreenHtml(p, screen, {
    dark: opts.mode === "dark",
    ...(themeOf(board, opts.theme) ? { theme: themeOf(board, opts.theme) as string } : {}),
    viewport: { w: frame.w, h: frame.h },
  });
}

/** Board → one standalone composite HTML document (frames as inlined srcdoc iframes). */
export async function exportBoardHtml(
  p: ExportPipeline,
  board: Board,
  opts: ExportOptions = {},
): Promise<StandaloneResult> {
  const composite = await boardComposite(p, board, opts, true);
  return {
    html: composite.html,
    warnings: [...composite.warnings, ...sizeWarning(composite.html)],
  };
}

async function boardComposite(
  p: ExportPipeline,
  board: Board,
  opts: ExportOptions,
  standalone: boolean,
): Promise<{ html: string; viewport: Viewport; warnings: string[] }> {
  const dark = opts.mode === "dark";
  const themeName = themeOf(board, opts.theme);
  const warnings: string[] = [];
  const frames = [];
  for (const frame of board.frames) {
    const screen = p.folder.screens.get(frame.screen);
    if (!screen) continue;
    let html = await renderExportHtml(p, screen, {
      dark,
      themeName,
      viewport: { w: frame.w, h: frame.h },
      standalone,
    });
    if (standalone) {
      // Inline each frame document BEFORE composing — the composite itself
      // references nothing external, so inlined frames make the whole file
      // self-contained.
      const inlined = await inlineStandaloneDocument(html, {
        assetRoot: p.folder.root,
        skipSizeWarning: true,
      });
      html = inlined.html;
      warnings.push(...inlined.warnings);
    }
    frames.push({ frame, html, label: frame.label ?? screen.name ?? screen.id });
  }
  if (frames.length === 0) throw new Error(`board "${board.id}" has no exportable frames`);
  const composite = buildBoardComposite(frames, { labels: true });
  return { html: composite.html, viewport: composite.viewport, warnings: dedupe(warnings) };
}

const dedupe = (list: string[]): string[] => [...new Set(list)];
