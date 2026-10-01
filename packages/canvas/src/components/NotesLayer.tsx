import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { notes as notesApi } from "../api.ts";
import { isDraftNote } from "../store/annotations.ts";
import { type CanvasNoteEntry, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import {
  FREE_NOTE_CLASS,
  NOTE_CARD_CLASS,
  NOTE_TEXT,
  NoteBody,
  NoteCardAnchor,
  NoteMarker,
  NoteScroll,
  placeNoteMarkers,
  useNoteReveal,
} from "./note-view.tsx";
import { RichMarkdownEditor } from "./RichMarkdownEditor.tsx";

/**
 * Markdown notes on a board, in the same coord space as Frames.
 *
 * A free note is type set straight on the canvas — a thin rule and the text,
 * no paper behind it — wherever the author put it, at the size they drew.
 * An attached note sits inline on its node as a small marker, over the frame's
 * content; hovering opens it, clicking keeps it open. Both edit the same way:
 * double-click (or select and press Enter), drag a handle to resize, and every
 * change is a step on the canvas's undo stack.
 *
 * The Board's pointer handlers (empty space) and the Frame's select channel
 * (a node) handle creation in note mode.
 */
export function NotesLayer() {
  const notes = useCanvas((s) => s.notes);
  const visible = useCanvas((s) => s.markupVisible);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const board = useCanvas((s) => (currentBoardId ? s.boards[currentBoardId] : null));
  const nodeRects = useCanvas((s) => s.nodeRects);
  const frameInsets = useCanvas((s) => s.frameInsets);
  const threads = useCanvas((s) => s.commentThreads);
  if (!visible || notes.length === 0) return null;

  const { free, attached } = placeNoteMarkers(
    notes,
    board?.frames ?? [],
    frameInsets,
    nodeRects,
    threads,
  );

  return (
    <>
      {free.map(({ note, at }) => (
        <FreeNote key={note.id} note={note} pos={at} />
      ))}
      {attached.map(({ note, position, pileIndex, stale }) => (
        <AttachedNote
          key={note.id}
          note={note}
          position={position}
          pileIndex={pileIndex}
          stale={stale}
        />
      ))}
    </>
  );
}

const MIN_WIDTH = 120;
const MIN_HEIGHT = 32;

/**
 * The edit session every note shares: the draft text, and the one place that
 * decides whether leaving the editor saves, deletes or discards. A note that
 * was never saved (a draft) is written in one go on its first save, and an
 * emptied one goes away.
 */
function useNoteEditing(note: CanvasNoteEntry) {
  const editingId = useCanvas((s) => s.editingMarkupId);
  const setEditingId = useCanvas((s) => s.setEditingMarkupId);
  const boardId = useCanvas((s) => s.currentBoardId);
  const isEditing = editingId === note.id;
  const [text, setText] = useState(note.body);
  const exitingRef = useRef(false);

  useEffect(() => {
    setText(note.body);
    exitingRef.current = false;
  }, [note.body]);

  const update = async (patch: { x?: number; y?: number; width?: number; height?: number }) => {
    if (isDraftNote(note.id)) {
      useCanvas.getState().updateDraftNote(note.id, patch);
      return;
    }
    if (!boardId) return;
    try {
      await notesApi.update({ boardId, noteId: note.id, patch });
    } catch (err) {
      toastError(err, "Could not update note");
    }
  };

  const remove = async () => {
    // Removing the note being edited must end the edit session too, or the
    // markup-edit camera never restores.
    if (useCanvas.getState().editingMarkupId === note.id) setEditingId(null);
    if (isDraftNote(note.id)) {
      useCanvas.getState().discardDraftNote(note.id);
      return;
    }
    if (!boardId) return;
    try {
      await notesApi.remove({ boardId, noteId: note.id });
    } catch (err) {
      toastError(err, "Could not remove note");
    }
  };

  const startEditing = () => {
    exitingRef.current = false;
    setEditingId(note.id);
  };

  const saveAndExit = async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    // A deferred blur can land after another note took over editing —
    // persist this text but don't close the new editor.
    if (useCanvas.getState().editingMarkupId === note.id) setEditingId(null);
    if (!text.trim()) {
      await remove();
      return;
    }
    if (isDraftNote(note.id)) {
      await useCanvas.getState().saveDraftNote(note.id, { body: text });
      return;
    }
    if (text === note.body || !boardId) return;
    try {
      await notesApi.update({ boardId, noteId: note.id, patch: { body: text } });
    } catch (err) {
      toastError(err, "Could not update note");
    }
  };

  const cancelAndExit = () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setText(note.body);
    setEditingId(null);
    if (isDraftNote(note.id)) useCanvas.getState().discardDraftNote(note.id);
  };

  return { isEditing, text, setText, update, remove, startEditing, saveAndExit, cancelAndExit };
}

type Editing = ReturnType<typeof useNoteEditing>;

function NoteEditor({ editing }: { editing: Editing }) {
  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <RichMarkdownEditor
        autoFocus
        ariaLabel="Note"
        value={editing.text}
        onChange={editing.setText}
        onBlur={() => void editing.saveAndExit()}
        placeholder="Write a note…"
        className={`min-h-[1.5em] ${NOTE_TEXT}`}
        onKeyDown={(e) => {
          // Enter is a new line now, so leaving is Escape or ⌘Enter — and
          // both keep what was written.
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            e.stopPropagation();
            void editing.saveAndExit();
          }
        }}
      />
    </div>
  );
}

function TrashButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label="Delete note"
      title="Delete note"
      data-note-trash
      className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-destructive group-hover/note:flex"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <Trash2 size={13} />
    </button>
  );
}

/**
 * Edge and corner handles for the editing note. `scale` turns pointer pixels
 * into the note's own units: the board zoom for a free note, 1 for a card that
 * counter-scales out of it.
 */
function ResizeHandles({
  size,
  scale,
  onResize,
  onCommit,
}: {
  size: () => { w: number; h: number };
  scale: () => number;
  onResize(next: { w: number; h: number }): void;
  onCommit(next: { w: number; h: number }): void;
}) {
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const last = useRef<{ w: number; h: number } | null>(null);
  const handle = (axis: "x" | "y" | "xy", className: string) => (
    <div
      aria-hidden="true"
      data-note-resize={axis}
      className={`absolute size-2.5 rounded-[2px] border border-primary bg-card ${className}`}
      // Keep the editor focused: losing it would end the edit mid-resize.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, ...size() };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const k = scale() || 1;
        const next = {
          w: axis === "y" ? s.w : Math.max(MIN_WIDTH, s.w + (e.clientX - s.x) / k),
          h: axis === "x" ? s.h : Math.max(MIN_HEIGHT, s.h + (e.clientY - s.y) / k),
        };
        last.current = next;
        onResize(next);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
        if (last.current) onCommit(last.current);
        last.current = null;
      }}
    />
  );
  return (
    <>
      {handle("x", "-right-[5px] top-1/2 -translate-y-1/2 cursor-ew-resize")}
      {handle("y", "-bottom-[5px] left-1/2 -translate-x-1/2 cursor-ns-resize")}
      {handle("xy", "-bottom-[5px] -right-[5px] cursor-nwse-resize")}
    </>
  );
}

/** Size during a resize; null while the note's own width and height apply. */
function useLiveSize(note: CanvasNoteEntry) {
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a committed size from the server ends the live one
  useEffect(() => {
    setLive(null);
  }, [note.width, note.height]);
  return [live, setLive] as const;
}

function FreeNote({ note, pos }: { note: CanvasNoteEntry; pos: { x: number; y: number } }) {
  const editing = useNoteEditing(note);
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const [live, setLive] = useLiveSize(note);
  const zoom = () => useCanvas.getState().canvasZoom || 1;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing.isEditing || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { ox: pos.x, oy: pos.y, sx: e.clientX / zoom(), sy: e.clientY / zoom() };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.style.left = `${d.ox + e.clientX / zoom() - d.sx}px`;
    e.currentTarget.style.top = `${d.oy + e.clientY / zoom() - d.sy}px`;
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    const dx = e.clientX / zoom() - d.sx;
    const dy = e.clientY / zoom() - d.sy;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    await editing.update({ x: d.ox + dx, y: d.oy + dy });
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas-positioned note — interactive div is intentional
    <div
      ref={ref}
      className={`group/note ${FREE_NOTE_CLASS} outline-none ${
        editing.isEditing
          ? "bg-card/80 outline-1 outline-offset-4 outline-primary"
          : "hover:bg-foreground/[0.03] focus:outline-1 focus:outline-offset-4 focus:outline-primary"
      }`}
      style={{
        left: pos.x,
        top: pos.y,
        width: live?.w ?? note.width,
        height: live?.h ?? note.height,
      }}
      data-note-id={note.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        editing.startEditing();
      }}
      onKeyDown={(e) => {
        if (editing.isEditing) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          void editing.remove();
        } else if (e.key === "Enter") {
          e.preventDefault();
          editing.startEditing();
        }
      }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so selecting a note takes Enter and Delete
      tabIndex={0}
    >
      <NoteScroll>
        {editing.isEditing ? (
          <NoteEditor editing={editing} />
        ) : (
          <NoteBody body={note.body} emptyHint="Empty note — double-click to edit" />
        )}
      </NoteScroll>
      {editing.isEditing ? (
        <ResizeHandles
          size={() => ({
            w: ref.current?.offsetWidth ?? note.width,
            h: ref.current?.offsetHeight ?? note.height ?? MIN_HEIGHT,
          })}
          scale={zoom}
          onResize={setLive}
          onCommit={(next) => void editing.update({ width: next.w, height: next.h })}
        />
      ) : (
        <TrashButton onRemove={() => void editing.remove()} />
      )}
    </div>
  );
}

function AttachedNote({
  note,
  position,
  pileIndex,
  stale,
}: {
  note: CanvasNoteEntry;
  /** The marker's spot, as CSS lengths (see `clampInsideFrame`). */
  position: { left: string; top: string };
  /** Its place in the pile of markers on the same spot. */
  pileIndex: number;
  stale: boolean;
}) {
  const editing = useNoteEditing(note);
  // A note just written is the one its author wants to see, so a fresh draft opens held.
  const reveal = useNoteReveal(isDraftNote(note.id));
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useLiveSize(note);
  const pinned = reveal.held;
  const setPinned = reveal.setHeld;
  const open = reveal.hovered || pinned || editing.isEditing;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing.isEditing) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void editing.remove();
    } else if (e.key === "Enter") {
      e.preventDefault();
      setPinned(true);
      editing.startEditing();
    } else if (e.key === "Escape" && pinned) {
      e.preventDefault();
      e.stopPropagation();
      setPinned(false);
    }
  };

  return (
    // Counter-scaled out of the board zoom, like comment pins: a marker and
    // its note read the same at any camera distance, and stack with them.
    <div data-note-id={note.id} data-note-attached="true" className="contents">
      <NoteMarker
        position={position}
        pileIndex={pileIndex}
        stale={stale}
        open={open}
        held={pinned || editing.isEditing}
        onEnter={reveal.enter}
        onLeave={reveal.leave}
        onToggle={() => setPinned((p) => !p)}
        onDoubleClick={() => {
          setPinned(true);
          editing.startEditing();
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <NoteCardAnchor position={position} onEnter={reveal.enter} onLeave={reveal.leave}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the opened note takes the same double-click and keys as its marker */}
          <div
            ref={cardRef}
            className={`group/note ${NOTE_CARD_CLASS} ${
              editing.isEditing ? "border-primary" : "border-border"
            }`}
            style={{ width: live?.w ?? note.width, height: live?.h ?? note.height }}
            data-note-card
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setPinned(true);
              editing.startEditing();
            }}
            onKeyDown={onKeyDown}
          >
            <NoteScroll>
              <div className="border-l-2 border-foreground/15 pl-3 pr-6">
                {editing.isEditing ? (
                  <NoteEditor editing={editing} />
                ) : (
                  <NoteBody body={note.body} emptyHint="Empty note — double-click to edit" />
                )}
                {stale ? (
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-destructive/80">
                    Its node is gone
                  </div>
                ) : null}
              </div>
            </NoteScroll>
            {editing.isEditing ? (
              <ResizeHandles
                size={() => ({
                  w: cardRef.current?.offsetWidth ?? note.width,
                  h: cardRef.current?.offsetHeight ?? note.height ?? MIN_HEIGHT,
                })}
                scale={() => 1}
                onResize={setLive}
                onCommit={(next) => void editing.update({ width: next.w, height: next.h })}
              />
            ) : (
              <TrashButton onRemove={() => void editing.remove()} />
            )}
          </div>
        </NoteCardAnchor>
      ) : null}
    </div>
  );
}
