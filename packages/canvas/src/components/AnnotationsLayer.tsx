import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { annotations as annotationsApi } from "../api.ts";
import { pathToString } from "../path.ts";
import { type AnnotationEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";

interface Props {
  pageId: string;
}

const ANNOTATION_WIDTH = 240;
const ANNOTATION_GAP = 32;
/**
 * Vertical offset of the iframe inside a VariantFrame (header text + flex
 * gap). VariantFrame's header is text-xs (~16px) plus a gap-2 (8px) before
 * the iframe wrapper, so the iframe's top edge sits ~28px below the
 * variant's recorded position. Approximate — annotation anchoring is
 * forgiving by a few px.
 */
const IFRAME_OFFSET_Y = 28;
const IFRAME_OFFSET_X = 0;

/**
 * Renders node-anchored annotations inside the canvas free-layout coord
 * space. Each annotation is a minimal container positioned to the left of
 * its variant by default, or at an explicit {x, y} after the user has
 * dragged it. A subtle connector line + arrowhead points at the targeted
 * variant; the connector strengthens when the annotation is focused or
 * when its target node is the canvas's current selection.
 */
export function AnnotationsLayer({ pageId }: Props) {
  const annotations = useCanvas((s) => s.annotations);
  const visible = useCanvas((s) => s.annotationsVisible);
  const page = useCanvas((s) => s.currentPage);
  const selection = useCanvas((s) => s.selection);
  const focusedId = useCanvas((s) => s.focusedAnnotationId);
  const nodeRects = useCanvas((s) => s.nodeRects);
  if (!visible || annotations.length === 0 || !page) return null;

  const placements = annotations.map((a) => {
    const variant = page.variants.find((v) => v.id === a.target.variantId);
    const vp = variant?.position;
    const resolvedKey = a.resolved !== null ? pathToString(a.resolved) : null;
    const nodeRect = resolvedKey ? nodeRects[a.target.variantId]?.[resolvedKey] : undefined;
    // Node center in canvas coords — variant origin + iframe inset + the
    // node's rect inside the iframe document. Falls back to the variant's
    // top-left when the iframe hasn't reported rects yet.
    const nodeAnchor =
      vp && nodeRect
        ? {
            x: vp.x + IFRAME_OFFSET_X + nodeRect.x,
            y: vp.y + IFRAME_OFFSET_Y + nodeRect.y,
            w: nodeRect.w,
            h: nodeRect.h,
          }
        : null;
    const explicit = typeof a.position === "object" ? a.position : null;
    // Auto-position: pinned to the left of the variant, vertically aligned
    // with the targeted node's center (so a long page's annotations don't
    // all pile up at the top).
    const auto = vp
      ? {
          x: vp.x - ANNOTATION_WIDTH - ANNOTATION_GAP,
          y: nodeAnchor ? nodeAnchor.y + nodeAnchor.h / 2 - 12 : vp.y,
        }
      : { x: 0, y: 0 };
    const pos = explicit ?? auto;
    const targetSelected =
      selection != null &&
      selection.variantId === a.target.variantId &&
      a.resolved != null &&
      selection.path === pathToString(a.resolved);
    const strong = focusedId === a.id || targetSelected;
    return { annotation: a, pos, variantPos: vp ?? null, nodeAnchor, strong };
  });

  return (
    <>
      {/* Connector layer beneath the annotation pills. The strong-connector
          marker uses currentColor so the arrowhead picks up the line's
          stroke; the subtle marker is muted via opacity. */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width: "100%", height: "100%", overflow: "visible" }}
      >
        <title>annotation connectors</title>
        <defs>
          <marker
            id="annotation-arrow-strong"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 9 5 L 0 10 z" fill="var(--color-accent)" />
          </marker>
          <marker
            id="annotation-arrow-subtle"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 9 5 L 0 10 z" fill="var(--color-fg-muted)" opacity="0.5" />
          </marker>
        </defs>
        {placements.map(({ annotation, pos, variantPos, nodeAnchor, strong }) => {
          if (!variantPos) return null;
          // Start at the annotation's right edge, vertically centered on
          // its first line.
          const x1 = pos.x + ANNOTATION_WIDTH;
          const y1 = pos.y + 12;
          // End at the node's left-center if we have a rect, otherwise the
          // variant's left edge as a coarse fallback.
          const x2 = nodeAnchor ? nodeAnchor.x : variantPos.x;
          const y2 = nodeAnchor ? nodeAnchor.y + nodeAnchor.h / 2 : variantPos.y + 28;
          return (
            <line
              key={`c-${annotation.id}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={strong ? "var(--color-accent)" : "var(--color-fg-muted)"}
              strokeOpacity={strong ? 0.9 : 0.5}
              strokeWidth={strong ? 1.5 : 1}
              strokeDasharray={strong ? undefined : "4 3"}
              markerEnd={strong ? "url(#annotation-arrow-strong)" : "url(#annotation-arrow-subtle)"}
            />
          );
        })}
      </svg>
      {placements.map(({ annotation, pos, strong }) => (
        <AnnotationItem
          key={annotation.id}
          pageId={pageId}
          annotation={annotation}
          pos={pos}
          strong={strong}
        />
      ))}
    </>
  );
}

interface ItemProps {
  pageId: string;
  annotation: AnnotationEntry;
  pos: { x: number; y: number };
  strong: boolean;
}

function AnnotationItem({ pageId, annotation, pos, strong }: ItemProps) {
  const editingId = useCanvas((s) => s.editingMarkupId);
  const setEditingId = useCanvas((s) => s.setEditingMarkupId);
  const setFocusedAnnotationId = useCanvas((s) => s.setFocusedAnnotationId);
  const setSelection = useCanvas((s) => s.setSelection);
  const isEditing = editingId === annotation.id;
  const [draft, setDraft] = useState(annotation.body);
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    setDraft(annotation.body);
  }, [annotation.body]);

  const collapsed = annotation.collapsed ?? false;
  const dangling = annotation.resolved === null;

  const commit = async (patch: Parameters<typeof annotationsApi.update>[0]["patch"]) => {
    try {
      await annotationsApi.update({ pageId, annotationId: annotation.id, patch });
    } catch (err) {
      toastError(err, "Could not update annotation");
    }
  };

  /** Focusing this annotation also selects the targeted node — the canvas
   * connector goes strong from both sides (annotation-side and selection-side
   * predicates both trigger). */
  const focusAndSelectTarget = () => {
    setFocusedAnnotationId(annotation.id);
    if (annotation.resolved !== null) {
      setSelection({
        variantId: annotation.target.variantId,
        path: pathToString(annotation.resolved),
      });
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    focusAndSelectTarget();
    if (isEditing) return;
    if (e.button !== 0) return;
    e.currentTarget.style.zIndex = "10";
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { ox: pos.x, oy: pos.y, sx: e.clientX, sy: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const zoom = useCanvas.getState().canvasZoom || 1;
    const dx = (e.clientX - d.sx) / zoom;
    const dy = (e.clientY - d.sy) / zoom;
    e.currentTarget.style.left = `${d.ox + dx}px`;
    e.currentTarget.style.top = `${d.oy + dy}px`;
  };
  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    const zoom = useCanvas.getState().canvasZoom || 1;
    const dx = (e.clientX - d.sx) / zoom;
    const dy = (e.clientY - d.sy) / zoom;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // treat as click
    await commit({ position: { x: d.ox + dx, y: d.oy + dy } });
  };

  const saveAndExit = async () => {
    setEditingId(null);
    if (draft !== annotation.body) await commit({ body: draft });
  };

  // Visual: minimal container with a left-border accent rather than the full
  // Figma pill. Border-left + body text + a subtle chevron in the corner for
  // collapse. The "strong" state (focused or target selected) bumps the
  // border-left to accent color and adds a faint ring.
  const containerClass = [
    "absolute select-none rounded-md pl-3 pr-2 py-1.5 bg-[var(--color-surface)]",
    "border-l-2",
    strong
      ? "border-l-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30"
      : "border-l-[var(--color-border)]",
    dangling ? "opacity-50" : "",
    isEditing ? "ring-1 ring-[var(--color-accent)]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned annotation — interactive div is the right primitive
    <div
      className={containerClass}
      style={{ left: pos.x, top: pos.y, width: ANNOTATION_WIDTH }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so Del/Enter/c hotkeys work
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingId(annotation.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (isEditing) return;
          e.preventDefault();
          void annotationsApi
            .remove({ pageId, annotationId: annotation.id })
            .catch(() => undefined);
        } else if (e.key === "Enter" && !isEditing) {
          setEditingId(annotation.id);
        } else if (e.key === "c" && !isEditing) {
          e.preventDefault();
          void commit({ collapsed: !collapsed });
        }
      }}
    >
      {/* Chevron — only shown when there's content worth collapsing. Sits
          absolute in the top-right of the container so the body has room. */}
      {(annotation.body || collapsed) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void commit({ collapsed: !collapsed });
          }}
          className="absolute top-1 right-1 h-4 w-4 grid place-items-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>
      )}
      {dangling && (
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] mb-0.5">
          dangling
        </div>
      )}
      {!collapsed &&
        (isEditing ? (
          <textarea
            // biome-ignore lint/a11y/noAutofocus: editing flow expects immediate focus
            autoFocus
            className="w-full min-h-[2rem] bg-transparent text-sm leading-snug outline-none resize-none font-mono text-[var(--color-fg)] pr-4"
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
            ref={(el) => {
              if (!el) return;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            style={{ height: "auto" }}
          />
        ) : (
          <div className="text-[var(--color-fg)] flex flex-col gap-1 pr-4">
            <Markdown body={annotation.body || "*(empty annotation)*"} />
          </div>
        ))}
    </div>
  );
}
