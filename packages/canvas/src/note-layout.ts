import {
  FALLBACK_INSET,
  layoutAnnotations,
  type PlacedAnnotation,
  type Rect,
} from "./annotation-layout.ts";
import type { CanvasNoteEntry } from "./store/types.ts";

/**
 * Where each note on a board goes. Notes come in two shapes and this is
 * the one place that decides which is which:
 *
 *  - **free** — dropped on empty board space, positioned by its own x/y;
 *  - **attached** — anchored to a node inside a frame, laid out against
 *    that node's live rect and joined to it by a connector.
 *
 * An attached note is auto-placed until the user drags it, at which point
 * its x/y pin it — the same rule `Annotation.position` encodes as
 * `"auto"`, so the annotation layout math applies unchanged. A note whose
 * frame is no longer on the board degrades to free placement rather than
 * disappearing.
 */

export interface NoteFrameBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteLayoutItem {
  id: string;
  position: { x: number; y: number } | "auto";
  resolved: number[] | null;
  note: CanvasNoteEntry;
}

export interface NotePlan {
  /** Notes positioned by their own coordinates, in input order. */
  free: { note: CanvasNoteEntry; card: { x: number; y: number } }[];
  /** Attached notes grouped by the frame they anchor to. */
  sections: { frameId: string; placed: PlacedAnnotation<NoteLayoutItem>[] }[];
}

export function planNotes(
  notes: CanvasNoteEntry[],
  frames: NoteFrameBox[],
  nodeRects: Record<string, Record<string, Rect> | undefined>,
  frameInsets: Record<string, { x: number; y: number } | undefined>,
): NotePlan {
  const free: NotePlan["free"] = [];
  const byFrame = new Map<string, CanvasNoteEntry[]>();
  for (const note of notes) {
    const frameId = note.attachment?.frameId;
    if (!frameId || !frames.some((f) => f.id === frameId)) {
      free.push({ note, card: { x: note.x ?? 0, y: note.y ?? 0 } });
      continue;
    }
    const list = byFrame.get(frameId) ?? [];
    list.push(note);
    byFrame.set(frameId, list);
  }

  const sections: NotePlan["sections"] = [];
  for (const [frameId, attached] of byFrame) {
    const frame = frames.find((f) => f.id === frameId);
    if (!frame) continue;
    sections.push({
      frameId,
      placed: layoutAnnotations(
        attached.map(layoutItem),
        frame,
        frameInsets[frameId] ?? FALLBACK_INSET,
        nodeRects[frameId],
      ),
    });
  }
  return { free, sections };
}

function layoutItem(note: CanvasNoteEntry): NoteLayoutItem {
  return {
    id: note.id,
    position: note.x !== undefined && note.y !== undefined ? { x: note.x, y: note.y } : "auto",
    resolved: note.resolved ?? null,
    note,
  };
}

/**
 * Where notes sit on the canvas. A free note is placed by its own x/y. An
 * attached note sits inline, on its node: a marker at the node's top-right
 * corner, over the frame's content, which the canvas expands into the note on
 * hover. It never moves aside to make room — reading it is a hover away, and
 * the design stays unobstructed until then.
 *
 * (`planNotes` above is the earlier beside-the-frame layout, which the share
 * viewer still uses.)
 */
export interface NotePlacements {
  free: { note: CanvasNoteEntry; card: { x: number; y: number } }[];
  attached: { note: CanvasNoteEntry; marker: { x: number; y: number }; stale: boolean }[];
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
      marker: {
        x: Math.min(Math.max(corner.x, left), left + frame.w),
        y: Math.min(Math.max(corner.y, top), top + frame.h),
      },
      stale,
    });
  }
  return placements;
}

/** An attachment the screen tree no longer resolves. */
export function isStaleNote(note: CanvasNoteEntry): boolean {
  return note.attachment !== undefined && note.resolved === null;
}
