/** Shared store types — the vocabulary every slice (and consumer) speaks. */

export type RightTab = "node" | "theme" | "comments";
export type CursorMode = "select" | "hand" | "note" | "comment";
export type NodeState = "default" | "hover" | "focus" | "active" | "disabled";
export type AppTheme = "light" | "dark" | "system";
export type DesignMode = "light" | "dark";
export type ViewMode = "boards" | "library" | "snippet";
export type LibraryItemKind = "component" | "snippet";

export interface LibraryItemRef {
  kind: LibraryItemKind;
  id: string;
}

export interface AnnotationEntry {
  id: string;
  /** Screen the annotation is anchored to — stamped client-side on fetch. */
  screenId: string;
  target: { locator: number[] | string };
  position: { x: number; y: number } | "auto";
  body: string;
  collapsed?: boolean | undefined;
  resolved: number[] | null;
}

export interface NoteAttachment {
  frameId: string;
  screenId: string;
  locator: number[] | string;
}

export interface CanvasNoteEntry {
  id: string;
  /** Absent on an attached note until the user drags it off its anchor. */
  x?: number | undefined;
  y?: number | undefined;
  width: number;
  body: string;
  attachment?: NoteAttachment | undefined;
  /** Resolved node path for an attached note; null once the node is gone. */
  resolved?: number[] | null | undefined;
}

export interface Selection {
  screenId: string;
  path: string;
}
