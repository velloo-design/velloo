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

/** An attachment the screen tree no longer resolves. */
export function isStaleNote(note: CanvasNoteEntry): boolean {
  return note.attachment !== undefined && note.resolved === null;
}
