/** Shared store types — the vocabulary every slice (and consumer) speaks. */

export type RightTab = "node" | "theme";
export type CursorMode = "select" | "hand" | "note" | "annotate";
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
  target: { locator: number[] | string };
  position: { x: number; y: number } | "auto";
  body: string;
  collapsed?: boolean;
  resolved: number[] | null;
}

export interface CanvasNoteEntry {
  id: string;
  x: number;
  y: number;
  width: number;
  body: string;
}

export interface Selection {
  screenId: string;
  path: string;
}
