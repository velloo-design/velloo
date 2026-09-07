/**
 * Pure layout for node-anchored annotation cards: where each card sits in
 * board-world coords, the de-overlap pass, and the dashed-connector SVG
 * geometry. No store, no DOM — shared by the editing canvas
 * (AnnotationsLayer.tsx) and velloo-cloud's read-only share viewer.
 */

/**
 * Fallback iframe inset (offset of the iframe from the frame origin, in
 * board-world units) used only before the first chrome measurement lands.
 */
export const FALLBACK_INSET = { x: 0, y: 20 };
/** Distance from the right edge of the frame to the annotation card. */
export const CARD_GUTTER = 24;
/** Annotation card width — matches the `w-60` Tailwind class of the card. */
export const CARD_WIDTH = 240;
const CARD_HEIGHT_ESTIMATE = 60;

export interface AnnotationLayoutInput {
  id: string;
  position: { x: number; y: number } | "auto";
  /** Resolved node path within the screen tree; null when the target is gone. */
  resolved: number[] | null;
}

interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedAnnotation<A extends AnnotationLayoutInput> {
  annotation: A;
  /** Board-world rect of the targeted node, when available. */
  nodeRect: Rect | null;
  /** Position of the annotation card in board world coordinates. */
  card: { x: number; y: number };
}

/**
 * Place each annotation's card next to `frame`, anchored to its node rect
 * (iframe-local, looked up by joined path in `rects`) when available:
 *
 *  - rect + "auto" position → card to the right of the frame, vertically
 *    centered on the node;
 *  - explicit {x, y} → the user dragged it there, honor it;
 *  - no rect → stack vertically next to the frame (first paint, or the
 *    targeted node has been removed).
 *
 * Ends with a de-overlap pass nudging later cards down so annotations near
 * the same node stay readable. Returns cards sorted by y.
 */
export function layoutAnnotations<A extends AnnotationLayoutInput>(
  annotations: A[],
  frame: FrameBox,
  inset: { x: number; y: number },
  rects: Record<string, Rect> | undefined,
): PlacedAnnotation<A>[] {
  const placed: PlacedAnnotation<A>[] = annotations.map((annotation, idx) => {
    const pathStr = annotation.resolved !== null ? annotation.resolved.join(".") : null;
    const rect = pathStr !== null ? (rects?.[pathStr] ?? null) : null;

    if (rect && annotation.position === "auto") {
      // Anchor in board coords: frame origin + iframe inset + iframe-local rect.
      const nodeRect = {
        x: frame.x + inset.x + rect.x,
        y: frame.y + inset.y + rect.y,
        w: rect.w,
        h: rect.h,
      };
      // Card sits to the right of the frame, vertically centered on the rect.
      const card = {
        x: frame.x + frame.w + CARD_GUTTER,
        y: Math.max(frame.y, nodeRect.y + nodeRect.h / 2 - CARD_HEIGHT_ESTIMATE / 2),
      };
      return { annotation, nodeRect, card };
    }

    if (typeof annotation.position === "object") {
      return {
        annotation,
        nodeRect: rect
          ? {
              x: frame.x + inset.x + rect.x,
              y: frame.y + inset.y + rect.y,
              w: rect.w,
              h: rect.h,
            }
          : null,
        card: { x: annotation.position.x, y: annotation.position.y },
      };
    }

    // Fallback: stack vertically next to the frame.
    return {
      annotation,
      nodeRect: null,
      card: {
        x: frame.x + frame.w + CARD_GUTTER,
        y: frame.y + 24 + idx * (CARD_HEIGHT_ESTIMATE + 16),
      },
    };
  });

  // De-overlap card y positions when multiple annotations anchor near
  // the same node — keep them readable by nudging later ones down.
  placed.sort((a, b) => a.card.y - b.card.y);
  let lastBottom = Number.NEGATIVE_INFINITY;
  for (const p of placed) {
    if (p.card.y < lastBottom + 8) p.card.y = lastBottom + 8;
    lastBottom = p.card.y + CARD_HEIGHT_ESTIMATE;
  }
  return placed;
}

export interface ConnectorGeometry {
  /** Board-world box the connector SVG must span (already padded). */
  box: { x: number; y: number; w: number; h: number };
  /** SVG path + anchor dot per connector, in box-local coordinates. */
  lines: { id: string; path: string; dot: { x: number; y: number } }[];
}

/**
 * Geometry for the dashed connector lines from each annotated node's right
 * edge to the left edge of its card, as a single SVG spanning all of them.
 * Null when nothing has a node rect to connect to.
 */
export function connectorGeometry<A extends AnnotationLayoutInput>(
  placed: PlacedAnnotation<A>[],
): ConnectorGeometry | null {
  const items = placed.filter(
    (p): p is PlacedAnnotation<A> & { nodeRect: Rect } => p.nodeRect !== null,
  );
  if (items.length === 0) return null;

  // SVG canvas needs to span every line we draw. Pick a permissive
  // bounding box so we don't clip.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of items) {
    const startX = p.nodeRect.x + p.nodeRect.w;
    const startY = p.nodeRect.y + p.nodeRect.h / 2;
    const endX = p.card.x;
    const endY = p.card.y + CARD_HEIGHT_ESTIMATE / 2;
    minX = Math.min(minX, startX, endX);
    minY = Math.min(minY, startY, endY);
    maxX = Math.max(maxX, startX, endX);
    maxY = Math.max(maxY, startY, endY);
  }
  // Add a small margin so dashed strokes don't sit on the SVG edge.
  const pad = 8;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const lines = items.map((p) => {
    const startX = p.nodeRect.x + p.nodeRect.w - minX;
    const startY = p.nodeRect.y + p.nodeRect.h / 2 - minY;
    const endX = p.card.x - minX;
    const endY = p.card.y + CARD_HEIGHT_ESTIMATE / 2 - minY;
    // Quadratic curve via a control point halfway across — gives the
    // line a gentle arc instead of a sharp polyline kink when the
    // card sits well above/below the rect.
    const ctrlX = (startX + endX) / 2;
    const path = `M ${startX} ${startY} Q ${ctrlX} ${startY} ${ctrlX} ${(startY + endY) / 2} T ${endX} ${endY}`;
    return { id: p.annotation.id, path, dot: { x: startX, y: startY } };
  });

  return {
    box: {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
    },
    lines,
  };
}
