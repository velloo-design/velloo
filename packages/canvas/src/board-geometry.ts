/**
 * Pure pan/zoom geometry for a board canvas. No store, no DOM — shared by
 * the editing canvas (Board.tsx / Frame.tsx) and velloo-cloud's read-only
 * share viewer, which sibling-imports this file so the two surfaces can't
 * drift on fit/zoom behavior.
 */

export interface PanZoom {
  pan: { x: number; y: number };
  zoom: number;
}

interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FrameInset {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

/** Wheel-step factor shared by every zoom gesture route (board + iframes). */
export function wheelZoomFactor(deltaY: number): number {
  return deltaY > 0 ? 0.95 : 1.05;
}

/**
 * Bounding box of the frames in board coords, padded below each frame by
 * `chromeAllowance` for the header row + preset chips. Null for an empty
 * board.
 */
export function contentBounds(
  frames: FrameBox[],
  chromeAllowance = 60,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (frames.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const f of frames) {
    if (f.x < minX) minX = f.x;
    if (f.y < minY) minY = f.y;
    if (f.x + f.w > maxX) maxX = f.x + f.w;
    if (f.y + f.h + chromeAllowance > maxY) maxY = f.y + f.h + chromeAllowance;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Fit-to-content view for a viewport of `vw`×`vh` CSS px: content centered,
 * zoom capped at 1.0 (never up-scale; MIN_ZOOM is the floor). Null when the
 * board is empty or the viewport hasn't laid out yet.
 */
export function fitToContent(
  frames: FrameBox[],
  vw: number,
  vh: number,
  margin = 80,
): PanZoom | null {
  const bounds = contentBounds(frames);
  if (!bounds || vw < 50 || vh < 50) return null;
  const boxW = Math.max(1, bounds.maxX - bounds.minX);
  const boxH = Math.max(1, bounds.maxY - bounds.minY);
  const boxCx = (bounds.minX + bounds.maxX) / 2;
  const boxCy = (bounds.minY + bounds.maxY) / 2;
  const zoomX = (vw - margin * 2) / boxW;
  const zoomY = (vh - margin * 2) / boxH;
  const zoom = Math.max(MIN_ZOOM, Math.min(1.0, Math.min(zoomX, zoomY)));
  return {
    zoom,
    pan: {
      x: Math.round(vw / 2 - boxCx * zoom),
      y: Math.round(vh / 2 - boxCy * zoom),
    },
  };
}

/**
 * Camera view that centers one frame in a `vw`×`vh` viewport: zoom fits the
 * frame (plus the chrome allowance below it, as in contentBounds) with a
 * margin, capped at 1.0 so a small frame lands at natural size instead of
 * blown up. Null when the viewport hasn't laid out yet. Used by "jump to
 * frame" navigation (search).
 */
/**
 * Camera view that centers an arbitrary board-space rect (a node's box) in a
 * `vw`×`vh` viewport. Like focusFrame but without the frame-chrome allowance,
 * and with a caller-set zoom ceiling — locating a small button shouldn't blow
 * it up to fill the screen, just center it at a readable zoom.
 */
export function focusRect(
  rect: FrameBox,
  vw: number,
  vh: number,
  margin = 120,
  maxZoom = 1,
): PanZoom | null {
  if (vw < 50 || vh < 50) return null;
  const zoomX = (vw - margin * 2) / Math.max(1, rect.w);
  const zoomY = (vh - margin * 2) / Math.max(1, rect.h);
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, zoomX, zoomY));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    zoom,
    pan: {
      x: Math.round(vw / 2 - cx * zoom),
      y: Math.round(vh / 2 - cy * zoom),
    },
  };
}

/**
 * Convert an iframe-viewport rect into board-world coordinates.
 *
 * Iframe rects come from `getBoundingClientRect()`, so scrolling can make
 * their x/y negative. Clamp the target to the visible frame viewport before
 * adding the frame and chrome offsets; camera navigation should center the
 * place the node is visible now, not an off-screen document coordinate.
 */
export function iframeRectToBoard(frame: FrameBox, inset: FrameInset, rect: FrameBox): FrameBox {
  const maxX = Math.max(0, frame.w - rect.w);
  const maxY = Math.max(0, frame.h - rect.h);
  return {
    x: frame.x + inset.x + Math.max(0, Math.min(rect.x, maxX)),
    y: frame.y + inset.y + Math.max(0, Math.min(rect.y, maxY)),
    w: rect.w,
    h: rect.h,
  };
}

export function focusFrame(
  frame: FrameBox,
  vw: number,
  vh: number,
  margin = 80,
  chromeAllowance = 60,
): PanZoom | null {
  if (vw < 50 || vh < 50) return null;
  const boxH = frame.h + chromeAllowance;
  const zoomX = (vw - margin * 2) / frame.w;
  const zoomY = (vh - margin * 2) / boxH;
  const zoom = Math.max(MIN_ZOOM, Math.min(1.0, zoomX, zoomY));
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + boxH / 2;
  return {
    zoom,
    pan: {
      x: Math.round(vw / 2 - cx * zoom),
      y: Math.round(vh / 2 - cy * zoom),
    },
  };
}

/**
 * Apply a zoom step centered on a point in wrapper-local coords. Keeps the
 * world coordinate under (anchorX, anchorY) fixed across the transition:
 * `cursor = pan + world * zoom` solved for the new pan after zoom changes.
 * Returns the current view unchanged when the zoom is already clamped.
 */
export function zoomAtPoint(
  anchorX: number,
  anchorY: number,
  factor: number,
  current: PanZoom,
): PanZoom {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * factor));
  if (nextZoom === current.zoom) return current;
  // world coord under the cursor before the zoom change
  const worldX = (anchorX - current.pan.x) / current.zoom;
  const worldY = (anchorY - current.pan.y) / current.zoom;
  // after the zoom change, pin the same world coord under the cursor
  return {
    zoom: nextZoom,
    pan: {
      x: Math.round(anchorX - worldX * nextZoom),
      y: Math.round(anchorY - worldY * nextZoom),
    },
  };
}
