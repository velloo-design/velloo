import type { Annotation, Board, CanvasNote, Screen, Snippet, Theme } from "@velloo/schema";

/** Everything `velloo init` writes into a fresh design folder. */
export interface Scaffold {
  theme: Theme;
  screens: Screen[];
  boards: Board[];
  snippets: Snippet[];
  annotations: { screenId: string; entries: Annotation[] }[];
  notes: { boardId: string; entries: CanvasNote[] }[];
}
