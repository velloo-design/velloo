import { useEffect, useRef, useState } from "react";
import { notes as notesApi } from "../api.ts";
import { type CanvasNoteEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";

/**
 * Free-positioned markdown notes on a board. Each note is absolutely
 * positioned in board coords (same coord space as Frames). Click in note
 * mode to drop a new one; double-click to edit; drag to move.
 *
 * The Board's onPointerDown in "note" mode handles creation; this layer
 * just renders + edits.
 */
export function NotesLayer() {
  const notes = useCanvas((s) => s.notes);
  const visible = useCanvas((s) => s.annotationsVisible);
  if (!visible || notes.length === 0) return null;
  return (
    <>
      {notes.map((note) => (
        <Note key={note.id} note={note} />
      ))}
    </>
  );
}

function Note({ note }: { note: CanvasNoteEntry }) {
  const editingId = useCanvas((s) => s.editingMarkupId);
  const setEditingId = useCanvas((s) => s.setEditingMarkupId);
  const boardId = useCanvas((s) => s.currentBoardId);
  const isEditing = editingId === note.id;
  const [draft, setDraft] = useState(note.body);
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    setDraft(note.body);
  }, [note.body]);

  const commit = async (patch: Parameters<typeof notesApi.update>[0]["patch"]) => {
    if (!boardId) return;
    try {
      await notesApi.update({ boardId, noteId: note.id, patch });
    } catch (err) {
      toastError(err, "Could not update note");
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const zoom = useCanvas.getState().canvasZoom || 1;
    dragRef.current = {
      ox: note.x,
      oy: note.y,
      sx: e.clientX / zoom,
      sy: e.clientY / zoom,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const zoom = useCanvas.getState().canvasZoom || 1;
    const dx = e.clientX / zoom - d.sx;
    const dy = e.clientY / zoom - d.sy;
    e.currentTarget.style.left = `${d.ox + dx}px`;
    e.currentTarget.style.top = `${d.oy + dy}px`;
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    const zoom = useCanvas.getState().canvasZoom || 1;
    const dx = e.clientX / zoom - d.sx;
    const dy = e.clientY / zoom - d.sy;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    await commit({ x: d.ox + dx, y: d.oy + dy });
  };

  const saveAndExit = async () => {
    setEditingId(null);
    if (draft !== note.body) await commit({ body: draft });
  };

  const onRemove = async () => {
    if (!boardId) return;
    try {
      await notesApi.remove({ boardId, noteId: note.id });
    } catch (err) {
      toastError(err, "Could not remove note");
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned note — interactive div is intentional
    <div
      className={
        "absolute select-none rounded-md px-3 py-2 bg-amber-100 border border-amber-300 shadow-sm group/note text-amber-950 dark:text-amber-950 " +
        (isEditing ? "ring-2 ring-amber-500" : "")
      }
      style={{ left: note.x, top: note.y, width: note.width }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingId(note.id);
      }}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          void onRemove();
        } else if (e.key === "Enter") {
          setEditingId(note.id);
        }
      }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so hotkeys fire
      tabIndex={0}
    >
      {isEditing ? (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: editing flow expects focus
          autoFocus
          className="w-full min-h-[3rem] bg-transparent text-sm leading-snug outline-none resize-none font-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveAndExit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(note.body);
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
        <div className="text-sm leading-snug">
          {note.body ? (
            <Markdown body={note.body} />
          ) : (
            <span className="opacity-50">(empty note — double-click to edit)</span>
          )}
        </div>
      )}
    </div>
  );
}
