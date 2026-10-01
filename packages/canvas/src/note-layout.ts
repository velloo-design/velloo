import { FALLBACK_INSET, type Rect } from "./annotation-layout.ts";
import type { CanvasNoteEntry } from "./store/types.ts";

export interface NoteFrameBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where notes sit on the canvas. A free note is placed by its own x/y. An
 * attached note sits inline, on its node: a marker at the node's top-right
 * corner, over the frame's content, which the canvas expands into the note on
 * hover. It never moves aside to make room — reading it is a hover away, and
 * the design stays unobstructed until then.
 *
 * A note whose frame is no longer on the board degrades to free placement
 * rather than disappearing.
 */
export interface NotePlacements {
  free: { note: CanvasNoteEntry; card: { x: number; y: number } }[];
  attached: {
    note: CanvasNoteEntry;
    /** The node's top-right corner, unclamped. */
    marker: { x: number; y: number };
    /** The frame's content box, which the marker is held inside. */
    frame: { left: number; top: number; right: number; bottom: number };
    stale: boolean;
  }[];
}

export function placeNotes(
  notes: CanvasNoteEntry[],
  frames: NoteFrameBox[],
  nodeRects: Record<string, Record<string, Rect> | undefined>,
  frameInsets: Record<string, { x: number; y: number } | undefined>,
): NotePlacements {
  const placements: NotePlacements = { free: [], attached: [] };
  for (const note of notes) {
    const frame = note.attachment && frames.find((f) => f.id === note.attachment?.frameId);
    if (!frame) {
      placements.free.push({ note, card: { x: note.x ?? 0, y: note.y ?? 0 } });
      continue;
    }
    const inset = frameInsets[frame.id] ?? FALLBACK_INSET;
    const left = frame.x + inset.x;
    const top = frame.y + inset.y;
    const stale = isStaleNote(note);
    const rect = note.resolved ? nodeRects[frame.id]?.[note.resolved.join(".")] : undefined;
    // Unmeasured (the frame hasn't reported yet) or gone: the frame's corner,
    // which is still visibly *this* frame's note.
    const corner = { x: left + (rect ? rect.x + rect.w : frame.w), y: top + (rect ? rect.y : 0) };
    placements.attached.push({
      note,
      marker: corner,
      frame: { left, top, right: left + frame.w, bottom: top + frame.h },
      stale,
    });
  }
  return placements;
}

/** An attachment the screen tree no longer resolves. */
export function isStaleNote(note: CanvasNoteEntry): boolean {
  return note.attachment !== undefined && note.resolved === null;
}
