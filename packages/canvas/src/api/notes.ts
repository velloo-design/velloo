import type { CanvasNoteEntry, NoteAttachment } from "../store.ts";
import { postJson } from "./http.ts";

export const notes = {
  add(args: {
    boardId: string;
    x?: number;
    y?: number;
    width?: number;
    body: string;
    attachment?: NoteAttachment;
  }) {
    return postJson<{ note: CanvasNoteEntry }>("/api/notes/add", args);
  },
  update(args: {
    boardId: string;
    noteId: string;
    patch: { x?: number; y?: number; width?: number; body?: string };
  }) {
    return postJson<{ note: CanvasNoteEntry }>("/api/notes/update", args);
  },
  remove(args: { boardId: string; noteId: string }) {
    return postJson<{ removedId: string }>("/api/notes/remove", args);
  },
};
