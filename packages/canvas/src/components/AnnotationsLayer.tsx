import { Trash2 } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CARD_WIDTH,
  connectorGeometry,
  FALLBACK_INSET,
  layoutAnnotations,
  type PlacedAnnotation,
} from "../annotation-layout.ts";
import { annotations as annotationsApi } from "../api.ts";
import { type AnnotationEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";
import { Button } from "./ui/button.tsx";

/** Cap for both the edit textarea and the collapsed display body. */
const BODY_MAX_HEIGHT_PX = 160;

/**
 * Annotations are anchored to nodes within a screen. The iframe runtime
 * reports each annotated node's bounding rect on demand; we translate
 * that into board-world coords using the host frame's position and draw
 * a connector line from the rect's right edge to the annotation card.
 * The placement/de-overlap/connector math lives in annotation-layout.ts
 * (shared with velloo-cloud's read-only share viewer).
 *
 * Cards are shown for every screen that has a frame on the current board
 * (not only currentScreenId), so annotations stay visible when focus
 * moves between screens during agent work.
 *
 * Falls back to "next to the first matching frame, stacked vertically"
 * when no rect is available — happens on first paint before the
 * `requestRects` round-trip lands, or when the targeted node has been
 * removed since the annotation was authored. The FALLBACK_INSET is only
 * used before the first chrome measurement lands: each frame's real
 * chrome is observed by a ResizeObserver in `Frame.tsx` and reported
 * into `frameInsets`, so anchors stay locked through chrome edits.
 */
export function AnnotationsLayer() {
  const visible = useCanvas((s) => s.markupVisible);
  const annotations = useCanvas((s) => s.annotations);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const board = useCanvas((s) => (currentBoardId ? s.boards[currentBoardId] : null));
  const nodeRects = useCanvas((s) => s.nodeRects);
  const frameInsets = useCanvas((s) => s.frameInsets);
  if (!visible || annotations.length === 0 || !board) return null;

  // Group by screen; place against the first frame that hosts that screen.
  const byScreen = new Map<string, AnnotationEntry[]>();
  for (const a of annotations) {
    const list = byScreen.get(a.screenId) ?? [];
    list.push(a);
    byScreen.set(a.screenId, list);
  }

  const sections: { screenId: string; resolved: PlacedAnnotation<AnnotationEntry>[] }[] = [];
  for (const [screenId, anns] of byScreen) {
    const targetFrame = board.frames.find((f) => f.screen === screenId);
    if (!targetFrame) continue;
    const inset = frameInsets[targetFrame.id] ?? FALLBACK_INSET;
    sections.push({
      screenId,
      resolved: layoutAnnotations(anns, targetFrame, inset, nodeRects[targetFrame.id]),
    });
  }
  if (sections.length === 0) return null;

  return (
    <>
      {sections.map(({ screenId, resolved }) => (
        <Fragment key={screenId}>
          <Connectors resolved={resolved} />
          {resolved.map((r) => (
            <Annotation
              key={r.annotation.id}
              annotation={r.annotation}
              pos={r.card}
              screenId={screenId}
            />
          ))}
        </Fragment>
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
function Connectors({ resolved }: { resolved: PlacedAnnotation<AnnotationEntry>[] }) {
  const geometry = connectorGeometry(resolved);
  if (!geometry) return null;
  const { box, lines } = geometry;

  return (
    <svg
      className="absolute pointer-events-none text-primary/50"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      width={box.w}
      height={box.h}
      aria-hidden="true"
    >
      <title>Annotation connectors</title>
      {lines.map((line) => (
        <g key={line.id}>
          <path
            d={line.path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <circle cx={line.dot.x} cy={line.dot.y} r={3} fill="currentColor" />
        </g>
      ))}
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
  const exitingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const stale = annotation.resolved === null;

  useEffect(() => {
    setDraft(annotation.body);
    exitingRef.current = false;
    setExpanded(false);
  }, [annotation.body]);

  const growTextarea = (el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, BODY_MAX_HEIGHT_PX)}px`;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure overflow when the body text changes
  useLayoutEffect(() => {
    if (isEditing || expanded) {
      setOverflows(false);
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > BODY_MAX_HEIGHT_PX + 1);
  }, [annotation.body, isEditing, expanded]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-grow on each keystroke; growTextarea only touches refs
  useLayoutEffect(() => {
    if (!isEditing) return;
    growTextarea(textareaRef.current);
  }, [draft, isEditing]);

  const onRemove = async () => {
    // Removing the card being edited must end the edit session too, or the
    // markup-edit camera never restores.
    if (useCanvas.getState().editingMarkupId === annotation.id) setEditingId(null);
    try {
      await annotationsApi.remove({ screenId, annotationId: annotation.id });
    } catch (err) {
      toastError(err, "Could not remove annotation");
    }
  };

  const saveAndExit = async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    // A deferred blur can land after another card took over editing —
    // persist this draft but don't close the new editor.
    if (useCanvas.getState().editingMarkupId === annotation.id) setEditingId(null);
    if (!draft.trim()) {
      await onRemove();
      return;
    }
    if (draft !== annotation.body) {
      try {
        await annotationsApi.update({
          screenId,
          annotationId: annotation.id,
          patch: { body: draft },
        });
      } catch (err) {
        toastError(err, "Could not update annotation");
        exitingRef.current = false;
      }
    }
  };

  const cancelAndExit = () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setDraft(annotation.body);
    setEditingId(null);
    if (!annotation.body.trim()) void onRemove();
  };

  /** Defer blur commit so React Strict Mode remount autofocus doesn't delete empties. */
  const onBlurSave = () => {
    requestAnimationFrame(() => {
      if (textareaRef.current && document.activeElement === textareaRef.current) return;
      void saveAndExit();
    });
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned interactive
    <div
      className={
        "group/ann absolute select-none rounded-md pl-3 pr-2 py-1.5 bg-card border-l-2 shadow-sm transition-opacity " +
        (stale ? "border-l-muted-foreground/40" : "border-l-primary") +
        " " +
        (isEditing ? "opacity-100 ring-1 ring-primary" : "opacity-60 hover:opacity-100")
      }
      style={{ left: pos.x, top: pos.y, width: CARD_WIDTH }}
      title={stale ? "Targeted node has been removed — this annotation is stale." : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: hotkey target
      tabIndex={0}
      onMouseLeave={() => setExpanded(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        exitingRef.current = false;
        setEditingId(annotation.id);
      }}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          void onRemove();
        } else if (e.key === "Enter") {
          exitingRef.current = false;
          setEditingId(annotation.id);
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={
          "absolute top-0.5 right-0.5 text-muted-foreground hover:text-destructive " +
          (isEditing ? "opacity-100" : "opacity-0 group-hover/ann:opacity-100")
        }
        title="Remove annotation"
        aria-label="Remove annotation"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void onRemove();
        }}
      >
        <Trash2 />
      </Button>
      {isEditing ? (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: editing flow
          autoFocus
          className="w-full min-h-8 bg-transparent text-sm leading-snug outline-none resize-none font-mono pr-5 overflow-y-auto"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onBlurSave}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelAndExit();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void saveAndExit();
            }
          }}
          ref={growTextarea}
          style={{ height: "auto", maxHeight: BODY_MAX_HEIGHT_PX }}
        />
      ) : (
        <div className="text-sm leading-snug pr-5">
          {annotation.body ? (
            <>
              <div
                ref={bodyRef}
                className={expanded ? undefined : "overflow-hidden"}
                style={expanded ? undefined : { maxHeight: BODY_MAX_HEIGHT_PX }}
              >
                <Markdown body={annotation.body} />
              </div>
              {overflows && !expanded ? (
                <button
                  type="button"
                  className="mt-0.5 text-xs text-primary hover:underline"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(true);
                  }}
                >
                  …more
                </button>
              ) : null}
            </>
          ) : (
            <span className="opacity-50">(empty annotation)</span>
          )}
        </div>
      )}
    </div>
  );
}
