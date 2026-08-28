import type { Frame, Viewport } from "@velloo/schema";

/**
 * The shared board-composite builder: one HTML document laying a
 * board's frames out in board coordinate space — each frame an
 * `<iframe srcdoc>` (isolated document, same trick as the light/dark compare
 * wrapper) clipped to its frame rect, the whole canvas CSS-scaled down to
 * `maxWidth` so a sprawling board still rasterizes as one modest image.
 * Consumed by `velloo publish` (bundle screenshots) and the export core
 * (board → PNG/HTML); both see the exact same layout the canvas shows.
 */

/** Pixel-width cap for board composites before CSS downscaling kicks in. */
export const BOARD_COMPOSITE_MAX_WIDTH = 1600;
const BOARD_PADDING = 24;
/** Vertical room reserved above each frame for its label chip. */
const LABEL_HEIGHT = 26;

export interface BoardCompositeFrame {
  frame: Frame;
  /** Full HTML document for the frame's screen, embedded via srcdoc. */
  html: string;
  /** Label chip above the frame (frame label / screen name). Only rendered with `labels: true`. */
  label?: string;
}

export interface BoardCompositeOptions {
  /**
   * Output-width cap: a wider board is CSS-scaled down to this. Raising it
   * trades payload size for fidelity (the export routes pair it with
   * deviceScaleFactor for retina output).
   */
  maxWidth?: number;
  /** Render each frame's label chip above it (export decks); default false (publish parity). */
  labels?: boolean;
}

export interface BoardComposite {
  html: string;
  /** Output raster size after the downscale — capture at exactly this viewport. */
  viewport: Viewport;
  /** Applied CSS scale (≤1); 1 means the board fit within maxWidth. */
  scale: number;
}

export function buildBoardComposite(
  frames: BoardCompositeFrame[],
  options: BoardCompositeOptions = {},
): BoardComposite {
  const maxWidth = options.maxWidth ?? BOARD_COMPOSITE_MAX_WIDTH;
  const labelPad = options.labels ? LABEL_HEIGHT : 0;
  const minX = Math.min(...frames.map(({ frame }) => frame.x));
  const minY = Math.min(...frames.map(({ frame }) => frame.y));
  const maxX = Math.max(...frames.map(({ frame }) => frame.x + frame.w));
  const maxY = Math.max(...frames.map(({ frame }) => frame.y + frame.h));
  const w = maxX - minX + BOARD_PADDING * 2;
  const h = maxY - minY + BOARD_PADDING * 2 + labelPad;
  const scale = Math.min(1, maxWidth / w);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pieces = frames
    .map(({ frame, html, label }) => {
      const left = frame.x - minX + BOARD_PADDING;
      const top = frame.y - minY + BOARD_PADDING + labelPad;
      const chip =
        options.labels && label
          ? `<div class="label" style="left:${left}px;top:${top - LABEL_HEIGHT}px">${esc(label)}</div>`
          : "";
      return (
        chip +
        `<iframe scrolling="no" srcdoc="${esc(html)}" ` +
        `style="position:absolute;left:${left}px;top:${top}px;width:${frame.w}px;height:${frame.h}px"></iframe>`
      );
    })
    .join("\n    ");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;background:#f4f4f5;width:${outW}px;height:${outH}px;overflow:hidden}
.canvas{position:relative;width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:0 0}
.label{position:absolute;font:600 12px/1 ui-sans-serif,system-ui,sans-serif;color:#71717a;padding:4px 0}
iframe{border:1px solid #e4e4e7;background:#fff;display:block}
</style></head>
<body>
  <div class="canvas">
    ${pieces}
  </div>
</body></html>`;

  return { html, viewport: { w: outW, h: outH }, scale };
}
