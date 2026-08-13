import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { annotations as annotationsApi } from "../api.ts";
import { type AnnotationEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";

interface Props {
  pageId: string;
}

const ANNOTATION_WIDTH = 240;
const ANNOTATION_GAP = 24;

/**
 * Renders node-anchored annotations inside the canvas free-layout coord
 * space. Each annotation is a pill positioned either to the left of its
 * variant (auto) or at an explicit {x, y} after the user has dragged it.
 *
 * A connector line is drawn from the annotation's right edge to the
 * targeted variant's left edge when the variant has an explicit position.
 * For auto-flowed variants the line is omitted — users dragging the
 * annotation gives them positioning control, and the body text carries
 * the semantic association.
 */
export function AnnotationsLayer({ pageId }: Props) {
  const annotations = useCanvas((s) => s.annotations);
  const visible = useCanvas((s) => s.annotationsVisible);
  const page = useCanvas((s) => s.currentPage);
  if (!visible || annotations.length === 0 || !page) return null;

  // Resolve target variant positions for the connector layer.
  const placements = annotations.map((a) => {
    const variant = page.variants.find((v) => v.id === a.target.variantId);
    const vp = variant?.position;
    const explicit = typeof a.position === "object" ? a.position : null;
    const auto = vp ? { x: vp.x - ANNOTATION_WIDTH - ANNOTATION_GAP, y: vp.y } : { x: 0, y: 0 };
    const pos = explicit ?? auto;
    return { annotation: a, pos, variantPos: vp ?? null };
  });

  return (
    <>
      {/* SVG connector layer beneath the annotation pills. */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width: "100%", height: "100%", overflow: "visible" }}
      >
        <title>annotation connectors</title>
        {placements.map(({ annotation, pos, variantPos }) => {
          if (!variantPos) return null;
          const x1 = pos.x + ANNOTATION_WIDTH;
          const y1 = pos.y + 16;
          const x2 = variantPos.x;
          const y2 = variantPos.y + 40;
          return (
            <line
              key={`c-${annotation.id}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--color-border)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          );
        })}
      </svg>
      {placements.map(({ annotation, pos }) => (
        <AnnotationItem key={annotation.id} pageId={pageId} annotation={annotation} pos={pos} />
      ))}
    </>
  );
}

interface ItemProps {
  pageId: string;
  annotation: AnnotationEntry;
  pos: { x: number; y: number };
}

function AnnotationItem({ pageId, annotation, pos }: ItemProps) {
  const editingId = useCanvas((s) => s.editingMarkupId);
  const setEditingId = useCanvas((s) => s.setEditingMarkupId);
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned annotation pill — interactive div is the right primitive
    <div
      className={
        "absolute select-none rounded-lg border bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm " +
        (dangling
          ? "border-dashed border-[var(--color-border)] opacity-60"
          : "border-[var(--color-border)]")
      }
      style={{ left: pos.x, top: pos.y, width: ANNOTATION_WIDTH }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so Del/Enter/c hotkeys work on the selected annotation
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
      <header className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void commit({ collapsed: !collapsed });
          }}
          className="hover:text-[var(--color-fg)]"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>
        <span className="flex-1 truncate">annotation{dangling ? " (dangling)" : ""}</span>
      </header>
      {!collapsed && (
        <div className="px-3 py-2">
          {isEditing ? (
            <textarea
              // biome-ignore lint/a11y/noAutofocus: editing flow expects immediate focus
              autoFocus
              className="w-full min-h-[2rem] bg-transparent text-sm leading-snug outline-none resize-none font-mono text-[var(--color-fg)]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={async () => {
                setEditingId(null);
                if (draft !== annotation.body) await commit({ body: draft });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(annotation.body);
                  setEditingId(null);
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
            <div className="prose-velloo cursor-text flex flex-col gap-1">
              <Markdown body={annotation.body || "*(empty annotation)*"} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
