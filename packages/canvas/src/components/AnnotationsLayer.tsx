import { useEffect, useState } from "react";
import { annotations as annotationsApi } from "../api.ts";
import { type AnnotationEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";

/**
 * Annotations are anchored to nodes within a screen. For Sprint A's
 * minimum, each annotation is rendered next to the first frame on the
 * current board that references the current screen — basic but useful
 * anchoring. Sprint D+ improves this with per-node rect anchoring.
 */
export function AnnotationsLayer() {
  const visible = useCanvas((s) => s.annotationsVisible);
  const annotations = useCanvas((s) => s.annotations);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const board = useCanvas((s) => (currentBoardId ? s.boards[currentBoardId] : null));
  if (!visible || annotations.length === 0 || !board || !currentScreenId) return null;

  const targetFrame = board.frames.find((f) => f.screen === currentScreenId);
  if (!targetFrame) return null;

  return (
    <>
      {annotations.map((a, idx) => {
        const pos =
          typeof a.position === "object"
            ? a.position
            : {
                x: targetFrame.x + targetFrame.w + 24,
                y: targetFrame.y + 24 + idx * 100,
              };
        return <Annotation key={a.id} annotation={a} pos={pos} screenId={currentScreenId} />;
      })}
    </>
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
        "absolute select-none rounded-md pl-3 pr-2 py-1.5 bg-card border-l-2 border-l-primary shadow-sm w-60 " +
        (isEditing ? "ring-1 ring-primary" : "")
      }
      style={{ left: pos.x, top: pos.y }}
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
          className="w-full min-h-[2rem] bg-transparent text-sm leading-snug outline-none resize-none font-mono"
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
