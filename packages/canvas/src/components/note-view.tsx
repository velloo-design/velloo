import type { Board, CommentThreadView } from "@velloo/schema";
import { StickyNote } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { placeNotes } from "../note-layout.ts";
import { clampInsideFrame, pileKey, pileTranslate } from "../pin-geometry.ts";
import type { CanvasNoteEntry } from "../store/types.ts";
import { commentPinPosition, type FrameInsets, type NodeRectsByFrame } from "./comment-pin.tsx";
import { Markdown } from "./Markdown.tsx";

/*
 * Notes on a board, as they look — driven entirely by props, like
 * comment-pin.tsx, and shared the same way: the canvas's NotesLayer builds its
 * editable notes from these pieces, and velloo-cloud's share viewer renders
 * `NotesView`, the read-only whole. A note reads the same on both.
 *
 * Nothing here may import `../store.ts` or `../api.ts`.
 */

/** How a note's text is set, read or written: titles and emphasis forward, the rest muted. */
export const NOTE_TEXT =
  "text-[13px] leading-relaxed text-muted-foreground [&_a]:text-foreground [&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground [&_strong]:text-foreground [&_b]:text-foreground";

/** A free note's box: a thin rule and the text, no paper behind it. */
export const FREE_NOTE_CLASS =
  "absolute flex flex-col gap-2 rounded-r-md border-l-2 border-foreground/15 py-1 pl-4 pr-3";

/** An opened attached note's card. */
export const NOTE_CARD_CLASS =
  "absolute left-4 top-4 flex flex-col rounded-md border bg-card px-3 py-2.5 shadow-lg";

export function NoteBody({ body, emptyHint }: { body: string; emptyHint?: string | undefined }) {
  if (!body) {
    return (
      <span className="text-[13px] text-muted-foreground/60">{emptyHint ?? "Empty note"}</span>
    );
  }
  return <Markdown body={body} className={NOTE_TEXT} />;
}

/**
 * The scrolling part of a note that has been resized shorter than its text.
 * The board pans on the wheel; while a note can still scroll, the wheel is
 * the note's (a pinch or ⌘-wheel still zooms the board).
 */
export function NoteScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (el.scrollHeight > el.clientHeight + 1) e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel);
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto" data-note-scroll>
      {children}
    </div>
  );
}

/** How long a hovered-open note waits after the pointer leaves, so it can be reached. */
const CLOSE_DELAY_MS = 160;

/** Hover opens a note; a click keeps it open until clicked again. */
export function useNoteReveal(initiallyHeld = false) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(initiallyHeld);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  return {
    hovered,
    held,
    setHeld,
    enter() {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setHovered(true);
    },
    leave() {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setHovered(false), CLOSE_DELAY_MS);
    },
  };
}

/**
 * An attached note's marker, on its node — in the accent colour so it reads
 * apart from the design under it, inverted while its note is held open.
 * Counter-scaled out of the board zoom, like comment pins, and piled with them.
 */
export function NoteMarker({
  position,
  pileIndex,
  stale,
  open,
  held,
  onEnter,
  onLeave,
  onToggle,
  onDoubleClick,
  onKeyDown,
}: {
  position: { left: string; top: string };
  pileIndex: number;
  stale: boolean;
  open: boolean;
  held: boolean;
  onEnter(): void;
  onLeave(): void;
  onToggle(): void;
  onDoubleClick?: (() => void) | undefined;
  onKeyDown?: ((event: React.KeyboardEvent) => void) | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={open ? "Note" : "Show note"}
      aria-expanded={open}
      data-note-marker
      data-stop-pan
      className={`absolute z-10 flex size-7 items-center justify-center rounded-full shadow-md transition-[scale] hover:z-20 hover:scale-110 ${
        stale
          ? "border border-dashed border-destructive bg-card text-destructive"
          : held
            ? "bg-primary-foreground text-primary ring-2 ring-primary"
            : "bg-primary text-primary-foreground ring-1 ring-primary-foreground/20"
      }`}
      style={{
        ...position,
        translate: pileTranslate(pileIndex),
        transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
      }}
      title={stale ? "Note — its node is gone" : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(e) => {
        if (!onDoubleClick) return;
        e.stopPropagation();
        onDoubleClick();
      }}
      onKeyDown={onKeyDown}
    >
      <StickyNote size={13} />
    </button>
  );
}

/** Where an opened attached note hangs: off its marker, at screen size. */
export function NoteCardAnchor({
  position,
  onEnter,
  onLeave,
  children,
}: {
  position: { left: string; top: string };
  onEnter(): void;
  onLeave(): void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hovering the note keeps it open
    <div
      className="absolute z-30"
      data-stop-pan
      style={{
        ...position,
        transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
        transformOrigin: "top left",
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  );
}

export interface PlacedNotes {
  free: { note: CanvasNoteEntry; at: { x: number; y: number } }[];
  attached: {
    note: CanvasNoteEntry;
    /** The marker's spot, as CSS lengths (see `clampInsideFrame`). */
    position: { left: string; top: string };
    /** Its place in the pile on that spot — after any comment pins there. */
    pileIndex: number;
    stale: boolean;
  }[];
}

/** Every note's place on the board, attached ones piled with the comment pins they share a spot with. */
export function placeNoteMarkers(
  notes: CanvasNoteEntry[],
  frames: Board["frames"],
  insets: FrameInsets,
  nodeRects: NodeRectsByFrame,
  threads: CommentThreadView[] = [],
): PlacedNotes {
  const { free, attached } = placeNotes(notes, frames, nodeRects, insets);
  const pile = new Map<string, number>();
  for (const thread of threads) {
    const at = commentPinPosition(thread, frames, insets, nodeRects);
    if (at) pile.set(pileKey(at), (pile.get(pileKey(at)) ?? 0) + 1);
  }
  return {
    free: free.map(({ note, card }) => ({ note, at: card })),
    attached: attached.map(({ note, marker, frame, stale }) => {
      const position = {
        left: clampInsideFrame(marker.x, frame.left, frame.right),
        top: clampInsideFrame(marker.y, frame.top, frame.bottom),
      };
      const key = pileKey(position);
      const pileIndex = pile.get(key) ?? 0;
      pile.set(key, pileIndex + 1);
      return { note, position, pileIndex, stale };
    }),
  };
}

/**
 * A board's notes, to read: free notes where they were put, attached ones as
 * markers that open on hover and stay open on click. Render inside the
 * board's world transform, which publishes `--canvas-zoom`.
 */
export function NotesView({
  notes,
  frames,
  insets,
  nodeRects,
  threads,
}: {
  notes: CanvasNoteEntry[];
  frames: Board["frames"];
  insets: FrameInsets;
  nodeRects: NodeRectsByFrame;
  /** Comment pins on the board, so a note on the same spot joins their pile. */
  threads?: CommentThreadView[] | undefined;
}) {
  const { free, attached } = placeNoteMarkers(notes, frames, insets, nodeRects, threads);
  return (
    <>
      {free.map(({ note, at }) => (
        <div
          key={note.id}
          data-note-id={note.id}
          data-stop-pan
          className={`${FREE_NOTE_CLASS} select-text`}
          style={{ left: at.x, top: at.y, width: note.width, height: note.height }}
        >
          <NoteScroll>
            <NoteBody body={note.body} />
          </NoteScroll>
        </div>
      ))}
      {attached.map((placed) => (
        <ReadOnlyAttachedNote key={placed.note.id} {...placed} />
      ))}
    </>
  );
}

function ReadOnlyAttachedNote({
  note,
  position,
  pileIndex,
  stale,
}: PlacedNotes["attached"][number]) {
  const reveal = useNoteReveal();
  const open = reveal.hovered || reveal.held;
  return (
    <div data-note-id={note.id} data-note-attached="true" className="contents">
      <NoteMarker
        position={position}
        pileIndex={pileIndex}
        stale={stale}
        open={open}
        held={reveal.held}
        onEnter={reveal.enter}
        onLeave={reveal.leave}
        onToggle={() => reveal.setHeld((h) => !h)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && reveal.held) {
            e.preventDefault();
            e.stopPropagation();
            reveal.setHeld(false);
          }
        }}
      />
      {open ? (
        <NoteCardAnchor position={position} onEnter={reveal.enter} onLeave={reveal.leave}>
          <div
            className={`${NOTE_CARD_CLASS} select-text border-border`}
            style={{ width: note.width, height: note.height }}
            data-note-card
          >
            <NoteScroll>
              <div className="border-l-2 border-foreground/15 pl-3">
                <NoteBody body={note.body} />
                {stale ? (
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-destructive/80">
                    Its node is gone
                  </div>
                ) : null}
              </div>
            </NoteScroll>
          </div>
        </NoteCardAnchor>
      ) : null}
    </div>
  );
}
