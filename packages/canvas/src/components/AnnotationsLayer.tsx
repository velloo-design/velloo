import type { Frame } from "@velloo/schema";
import { useEffect, useState } from "react";
import { annotations as annotationsApi } from "../api.ts";
import { type AnnotationEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";

/**
 * Height of the `FrameHeader` chrome that sits above the iframe in
 * board-world units. Used to translate iframe-document coordinates
 * (where node rects are reported) into board coords for anchoring.
 *
 * Must stay in sync with the layout of `Frame.tsx` — header row is
 * `text-xs` (~16px) + the flex-col gap-1 (~4px). Keep this small and
 * obvious: if `Frame.tsx`'s structure changes, update this and the
 * connector lines will follow.
 */
const FRAME_IFRAME_OFFSET_Y = 20;
const FRAME_IFRAME_OFFSET_X = 0;
/** Distance from the right edge of the frame to the annotation card. */
const CARD_GUTTER = 24;
/** Annotation card width — matches the `w-60` Tailwind class below. */
const CARD_WIDTH = 240;
const CARD_HEIGHT_ESTIMATE = 60;

interface ResolvedAnnotation {
  annotation: AnnotationEntry;
  frame: Frame;
  /** Board-world rect of the targeted node, when available. */
  nodeRect: { x: number; y: number; w: number; h: number } | null;
  /** Position of the annotation card in board world coordinates. */
  card: { x: number; y: number };
}

/**
 * Annotations are anchored to nodes within a screen. The iframe runtime
 * reports each annotated node's bounding rect on demand; we translate
 * that into board-world coords using the host frame's position and draw
 * a connector line from the rect's right edge to the annotation card.
 *
 * Falls back to "next to the first matching frame, stacked vertically"
 * when no rect is available — happens on first paint before the
 * `requestRects` round-trip lands, or when the targeted node has been
 * removed since the annotation was authored.
 */
export function AnnotationsLayer() {
  const visible = useCanvas((s) => s.annotationsVisible);
  const annotations = useCanvas((s) => s.annotations);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const board = useCanvas((s) => (currentBoardId ? s.boards[currentBoardId] : null));
  const nodeRects = useCanvas((s) => s.nodeRects);
  if (!visible || annotations.length === 0 || !board || !currentScreenId) return null;

  const targetFrame = board.frames.find((f) => f.screen === currentScreenId);
  if (!targetFrame) return null;

  const resolved: ResolvedAnnotation[] = annotations.map((annotation, idx) => {
    const pathStr = annotation.resolved !== null ? annotation.resolved.join(".") : null;
    const rect = pathStr !== null ? (nodeRects[targetFrame.id]?.[pathStr] ?? null) : null;

    if (rect && annotation.position === "auto") {
      // Anchor in board coords: frame origin + iframe inset + iframe-local rect.
      const nodeRect = {
        x: targetFrame.x + FRAME_IFRAME_OFFSET_X + rect.x,
        y: targetFrame.y + FRAME_IFRAME_OFFSET_Y + rect.y,
        w: rect.w,
        h: rect.h,
      };
      // Card sits to the right of the frame, vertically centered on the rect.
      const card = {
        x: targetFrame.x + targetFrame.w + CARD_GUTTER,
        y: Math.max(targetFrame.y, nodeRect.y + nodeRect.h / 2 - CARD_HEIGHT_ESTIMATE / 2),
      };
      return { annotation, frame: targetFrame, nodeRect, card };
    }

    if (typeof annotation.position === "object") {
      return {
        annotation,
        frame: targetFrame,
        nodeRect: rect
          ? {
              x: targetFrame.x + FRAME_IFRAME_OFFSET_X + rect.x,
              y: targetFrame.y + FRAME_IFRAME_OFFSET_Y + rect.y,
              w: rect.w,
              h: rect.h,
            }
          : null,
        card: { x: annotation.position.x, y: annotation.position.y },
      };
    }

    // Fallback: stack vertically next to the first frame.
    return {
      annotation,
      frame: targetFrame,
      nodeRect: null,
      card: {
        x: targetFrame.x + targetFrame.w + CARD_GUTTER,
        y: targetFrame.y + 24 + idx * (CARD_HEIGHT_ESTIMATE + 16),
      },
    };
  });

  // De-overlap card y positions when multiple annotations anchor near
  // the same node — keep them readable by nudging later ones down.
  resolved.sort((a, b) => a.card.y - b.card.y);
  let lastBottom = Number.NEGATIVE_INFINITY;
  for (const r of resolved) {
    if (r.card.y < lastBottom + 8) r.card.y = lastBottom + 8;
    lastBottom = r.card.y + CARD_HEIGHT_ESTIMATE;
  }

  return (
    <>
      <Connectors resolved={resolved} />
      {resolved.map((r) => (
        <Annotation
          key={r.annotation.id}
          annotation={r.annotation}
          pos={r.card}
          screenId={currentScreenId}
        />
      ))}
    </>
  );
}

/**
 * Dashed connector lines from each annotated node's right edge to the
 * left edge of its annotation card. Rendered as a single board-spanning
 * SVG so we don't pay one SVG per annotation. Coordinates are board
 * world coords — the parent `<Board>` applies the pan/zoom transform.
 */
function Connectors({ resolved }: { resolved: ResolvedAnnotation[] }) {
  const items = resolved.filter(
    (
      r,
    ): r is ResolvedAnnotation & {
      nodeRect: NonNullable<ResolvedAnnotation["nodeRect"]>;
    } => r.nodeRect !== null,
  );
  if (items.length === 0) return null;

  // SVG canvas needs to span every line we draw. Pick a permissive
  // bounding box so we don't clip.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of items) {
    const startX = r.nodeRect.x + r.nodeRect.w;
    const startY = r.nodeRect.y + r.nodeRect.h / 2;
    const endX = r.card.x;
    const endY = r.card.y + CARD_HEIGHT_ESTIMATE / 2;
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
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  return (
    <svg
      className="absolute pointer-events-none text-primary/50"
      style={{ left: minX, top: minY, width: w, height: h }}
      width={w}
      height={h}
      aria-hidden="true"
    >
      <title>Annotation connectors</title>
      {items.map((r) => {
        const startX = r.nodeRect.x + r.nodeRect.w - minX;
        const startY = r.nodeRect.y + r.nodeRect.h / 2 - minY;
        const endX = r.card.x - minX;
        const endY = r.card.y + CARD_HEIGHT_ESTIMATE / 2 - minY;
        // Quadratic curve via a control point halfway across — gives the
        // line a gentle arc instead of a sharp polyline kink when the
        // card sits well above/below the rect.
        const ctrlX = (startX + endX) / 2;
        const path = `M ${startX} ${startY} Q ${ctrlX} ${startY} ${ctrlX} ${(startY + endY) / 2} T ${endX} ${endY}`;
        return (
          <g key={r.annotation.id}>
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={startX} cy={startY} r={3} fill="currentColor" />
          </g>
        );
      })}
    </svg>
  );
}

function Annotation({
  annotation,
  pos,
  screenId,
}: {
  annotation: AnnotationEntry;
  pos: { x: number; y: number };
  screenId: string;
}) {
  const editingId = useCanvas((s) => s.editingMarkupId);
  const setEditingId = useCanvas((s) => s.setEditingMarkupId);
  const isEditing = editingId === annotation.id;
  const [draft, setDraft] = useState(annotation.body);
  const stale = annotation.resolved === null;

  useEffect(() => {
    setDraft(annotation.body);
  }, [annotation.body]);

  const saveAndExit = async () => {
    setEditingId(null);
    if (draft !== annotation.body) {
      try {
        await annotationsApi.update({
          screenId,
          annotationId: annotation.id,
          patch: { body: draft },
        });
      } catch (err) {
        toastError(err, "Could not update annotation");
      }
    }
  };

  const onRemove = async () => {
    try {
      await annotationsApi.remove({ screenId, annotationId: annotation.id });
    } catch (err) {
      toastError(err, "Could not remove annotation");
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned interactive
    <div
      className={
        "absolute select-none rounded-md pl-3 pr-2 py-1.5 bg-card border-l-2 shadow-sm " +
        (stale ? "border-l-muted-foreground/40 opacity-70" : "border-l-primary") +
        " " +
        (isEditing ? "ring-1 ring-primary" : "")
      }
      style={{ left: pos.x, top: pos.y, width: CARD_WIDTH }}
      title={stale ? "Targeted node has been removed — this annotation is stale." : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: hotkey target
      tabIndex={0}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingId(annotation.id);
      }}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          void onRemove();
        } else if (e.key === "Enter") {
          setEditingId(annotation.id);
        }
      }}
    >
      {isEditing ? (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: editing flow
          autoFocus
          className="w-full min-h-8 bg-transparent text-sm leading-snug outline-none resize-none font-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveAndExit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(annotation.body);
              setEditingId(null);
            } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void saveAndExit();
            }
          }}
        />
      ) : (
        <div className="text-sm leading-snug">
          {annotation.body ? (
            <Markdown body={annotation.body} />
          ) : (
            <span className="opacity-50">(empty annotation)</span>
          )}
        </div>
      )}
    </div>
  );
}
