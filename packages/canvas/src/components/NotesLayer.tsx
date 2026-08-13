import { useEffect, useRef, useState } from "react";
import { notes as notesApi } from "../api.ts";
import { type CanvasNoteEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";

interface Props {
  pageId: string;
}

/**
 * Free-positioned markdown notes layer. Sits inside the canvas's free-layout
 * coord space (the same `.relative` container the variants live in), so
 * positions are in raw canvas pixels and respect pan/zoom by the parent's
 * transform.
 *
 * Notes never scroll — the box auto-expands downward as content grows. The
 * user-resizable dimension is width.
 */
export function NotesLayer({ pageId }: Props) {
  const notes = useCanvas((s) => s.notes);
  const visible = useCanvas((s) => s.annotationsVisible);
  if (!visible || notes.length === 0) return null;
  return (
    <>
      {notes.map((n) => (
        <NoteItem key={n.id} pageId={pageId} note={n} />
      ))}
    </>
  );
}

function NoteItem({ pageId, note }: { pageId: string; note: CanvasNoteEntry }) {
  const editingId = useCanvas((s) => s.editingMarkupId);
  const setEditingId = useCanvas((s) => s.setEditingMarkupId);
  const isEditing = editingId === note.id;
  const [draft, setDraft] = useState(note.body);
  const [width, setWidth] = useState(note.width);
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const resizeRef = useRef<{ startW: number; startX: number } | null>(null);

  useEffect(() => {
    setDraft(note.body);
    setWidth(note.width);
  }, [note.body, note.width]);

  const commit = async (patch: Parameters<typeof notesApi.update>[0]["patch"]) => {
    try {
      await notesApi.update({ pageId, noteId: note.id, patch });
    } catch (err) {
      toastError(err, "Could not update note");
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing) return;
    if ((e.target as HTMLElement).dataset.role === "resize") return;
    if (e.button !== 0) return;
    // Lift to top of stacking order on press.
    e.currentTarget.style.zIndex = "10";
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { ox: note.x, oy: note.y, sx: e.clientX, sy: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    // Pointer movement is in screen pixels; canvas may be zoomed. Divide
    // by the current zoom so we translate the same logical distance.
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
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // treat as a click
    await commit({ x: d.ox + dx, y: d.oy + dy });
  };

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { startW: width, startX: e.clientX };
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    const zoom = useCanvas.getState().canvasZoom || 1;
    const next = Math.max(120, r.startW + (e.clientX - r.startX) / zoom);
    setWidth(next);
  };
  const onResizeUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    resizeRef.current = null;
    if (Math.abs(width - r.startW) < 1) return;
    await commit({ width });
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned note — interactive div is the right primitive
    <div
      className="absolute select-none"
      style={{ left: note.x, top: note.y, width }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so Del/Enter hotkeys work on the selected note
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingId(note.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (isEditing) return;
          e.preventDefault();
          void notesApi.remove({ pageId, noteId: note.id }).catch(() => undefined);
        } else if (e.key === "Enter" && !isEditing) {
          setEditingId(note.id);
        }
      }}
    >
      {isEditing ? (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: editing flow expects immediate focus
          autoFocus
          className="w-full min-h-[2rem] bg-transparent text-sm leading-snug outline-none resize-none font-mono text-[var(--color-fg)]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={async () => {
            setEditingId(null);
            if (draft !== note.body) await commit({ body: draft });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(note.body);
              setEditingId(null);
            }
          }}
          // Grow with content so notes never scroll.
          ref={(el) => {
            if (!el) return;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          style={{ height: "auto" }}
        />
      ) : (
        <div className="prose-velloo text-[var(--color-fg)] cursor-text">
          <Markdown body={note.body || "*(empty note)*"} />
        </div>
      )}
      {/* East resize handle */}
      <div
        data-role="resize"
        className="absolute top-0 right-[-6px] h-full w-3 cursor-ew-resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
      />
    </div>
  );
}
