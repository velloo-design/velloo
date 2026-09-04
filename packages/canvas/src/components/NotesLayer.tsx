import { Fragment, useEffect, useRef, useState } from "react";
import { connectorGeometry, type PlacedAnnotation } from "../annotation-layout.ts";
import { notes as notesApi } from "../api.ts";
import { isStaleNote, type NoteLayoutItem, planNotes } from "../note-layout.ts";
import { type CanvasNoteEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Markdown } from "./Markdown.tsx";

/**
 * Markdown notes on a board, in the same coord space as Frames. A note is
 * either free — dropped on empty board space and positioned by its own
 * x/y — or attached to a node inside a frame, in which case it is placed
 * beside that frame against the node's live rect and joined to it by a
 * connector, until the user drags it and pins it down. `planNotes` owns
 * that split; this layer renders + edits.
 *
 * The Board's onPointerDown (empty space) and the Frame's select channel
 * (a node) handle creation in note mode.
 */
export function NotesLayer() {
  const notes = useCanvas((s) => s.notes);
  const visible = useCanvas((s) => s.markupVisible);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const board = useCanvas((s) => (currentBoardId ? s.boards[currentBoardId] : null));
  const nodeRects = useCanvas((s) => s.nodeRects);
  const frameInsets = useCanvas((s) => s.frameInsets);
  if (!visible || notes.length === 0) return null;

  const { free, sections } = planNotes(notes, board?.frames ?? [], nodeRects, frameInsets);

  return (
    <>
      {free.map(({ note, card }) => (
        <Note key={note.id} note={note} pos={card} />
      ))}
      {sections.map(({ frameId, placed }) => (
        <Fragment key={frameId}>
          <Connectors placed={placed} />
          {placed.map((p) => (
            <Note key={p.annotation.id} note={p.annotation.note} pos={p.card} />
          ))}
        </Fragment>
      ))}
    </>
  );
}

/** One board-spanning SVG for the whole frame group, as AnnotationsLayer does. */
function Connectors({ placed }: { placed: PlacedAnnotation<NoteLayoutItem>[] }) {
  const geometry = connectorGeometry(placed);
  if (!geometry) return null;
  const { box, lines } = geometry;
  return (
    <svg
      className="absolute pointer-events-none text-amber-500/70"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      width={box.w}
      height={box.h}
      aria-hidden="true"
    >
      <title>Note connectors</title>
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

function Note({ note, pos }: { note: CanvasNoteEntry; pos: { x: number; y: number } }) {
  const editingId = useCanvas((s) => s.editingMarkupId);
  const setEditingId = useCanvas((s) => s.setEditingMarkupId);
  const boardId = useCanvas((s) => s.currentBoardId);
  const isEditing = editingId === note.id;
  const [draft, setDraft] = useState(note.body);
  const exitingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  // An anchor the screen tree no longer resolves: the note is still the
  // author's, so it stays put and says so rather than vanishing.
  const stale = isStaleNote(note);

  useEffect(() => {
    setDraft(note.body);
    exitingRef.current = false;
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
      ox: pos.x,
      oy: pos.y,
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
    // Dragging an attached note pins it here; the anchor (and its
    // connector) survive, only the auto-placement is given up.
    await commit({ x: d.ox + dx, y: d.oy + dy });
  };

  const onRemove = async () => {
    if (!boardId) return;
    // Removing the note being edited must end the edit session too, or the
    // markup-edit camera never restores.
    if (useCanvas.getState().editingMarkupId === note.id) setEditingId(null);
    try {
      await notesApi.remove({ boardId, noteId: note.id });
    } catch (err) {
      toastError(err, "Could not remove note");
    }
  };

  const saveAndExit = async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    // A deferred blur can land after another card took over editing —
    // persist this draft but don't close the new editor.
    if (useCanvas.getState().editingMarkupId === note.id) setEditingId(null);
    if (!draft.trim()) {
      await onRemove();
      return;
    }
    if (draft !== note.body) await commit({ body: draft });
  };

  const cancelAndExit = () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setDraft(note.body);
    setEditingId(null);
    if (!note.body.trim()) void onRemove();
  };

  /** Defer blur commit so React Strict Mode remount autofocus doesn't delete empties. */
  const onBlurSave = () => {
    requestAnimationFrame(() => {
      if (textareaRef.current && document.activeElement === textareaRef.current) return;
      void saveAndExit();
    });
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned note — interactive div is intentional
    <div
      className={
        "absolute select-none rounded-md px-3 py-2 bg-amber-100 border shadow-sm group/note text-amber-950 dark:text-amber-950 " +
        (stale ? "border-dashed border-amber-400 opacity-70 " : "border-amber-300 ") +
        (isEditing ? "ring-2 ring-amber-500" : "")
      }
      style={{ left: pos.x, top: pos.y, width: note.width }}
      data-note-id={note.id}
      data-note-attached={note.attachment ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        exitingRef.current = false;
        setEditingId(note.id);
      }}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          void onRemove();
        } else if (e.key === "Enter") {
          exitingRef.current = false;
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
          ref={(el) => {
            textareaRef.current = el;
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
          {stale ? (
            <div className="mt-1 text-[11px] uppercase tracking-wide opacity-60">
              target removed
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
